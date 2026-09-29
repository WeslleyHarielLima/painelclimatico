"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import IrrigacaoHeatmap, { PrevisaoDiaria } from "./IrrigacaoHeatmap";
import { rotuloDiaAbs } from "./previsaoUtils";
import CamadaEstadoColorido, { GradeIrrigacao, Metrica } from "./CamadaEstadoColorido";
import {
  RAMPA_CHUVA,
  RAMPA_VENTO,
  RAMPA_UMIDADE,
  RAMPA_TEMPERATURA,
  STATUS_IRRIGACAO,
} from "./heatmapColors";

// Corrige o caminho dos ícones padrão do Leaflet, que quebram com bundlers.
const iconeMarcador = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Limites aproximados do estado de Rondônia, usados para enquadrar o mapa
// automaticamente (sempre mostrando o estado inteiro, em qualquer tela) e
// para restringir o quanto o usuário pode arrastar/afastar o mapa.
const LIMITES_RO: [[number, number], [number, number]] = [
  [-13.9, -67.0],
  [-7.7, -59.5],
];

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000/api";

interface DadosClimaticos {
  localizacao: { lat: number; lon: number };
  atual: {
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    precipitation: number;
    wind_speed_10m: number;
  };
  previsao_diaria: PrevisaoDiaria & {
    temperature_2m_max: number[];
    temperature_2m_min: number[];
  };
}

// Zoom mínimo ao clicar/ir para um ponto — se o usuário já estiver mais
// próximo que isso, o zoom atual é mantido (nunca afasta a visão).
const ZOOM_AO_IR_PARA_PONTO = 10;

function SeletorDeLocal({
  onSelecionar,
}: {
  onSelecionar: (lat: number, lon: number) => void;
}) {
  const mapa = useMapEvents({
    click(e) {
      onSelecionar(e.latlng.lat, e.latlng.lng);
      mapa.flyTo(e.latlng, Math.max(mapa.getZoom(), ZOOM_AO_IR_PARA_PONTO), {
        duration: 0.8,
      });
    },
  });
  return null;
}

const OPCOES_METRICA: { valor: Metrica; rotulo: string }[] = [
  { valor: "irrigacao", rotulo: "Irrigação" },
  { valor: "temperatura", rotulo: "Temperatura" },
  { valor: "chuva", rotulo: "Chuva" },
  { valor: "umidade", rotulo: "Umidade" },
  { valor: "vento", rotulo: "Vento" },
  { valor: "vento_direcao", rotulo: "Direção do vento" },
];

const LEGENDAS: Record<
  Metrica,
  { rampa: string[]; minimo: string; maximo: string } | null
> = {
  chuva: { rampa: RAMPA_CHUVA, minimo: "0 mm", maximo: "20+ mm" },
  vento: { rampa: RAMPA_VENTO, minimo: "0 km/h", maximo: "40+ km/h" },
  umidade: { rampa: RAMPA_UMIDADE, minimo: "< 40%", maximo: "> 85%" },
  temperatura: { rampa: RAMPA_TEMPERATURA, minimo: "< 24°C", maximo: "> 33°C" },
  irrigacao: null,
  vento_direcao: null,
};

export default function MapaClimatico() {
  const mapaRef = useRef<L.Map | null>(null);
  const [posicao, setPosicao] = useState<[number, number] | null>(null);
  const [dados, setDados] = useState<DadosClimaticos | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [grade, setGrade] = useState<GradeIrrigacao | null>(null);
  const [erroGrade, setErroGrade] = useState<string | null>(null);
  const [metrica, setMetrica] = useState<Metrica>("irrigacao");

  const [latDigitada, setLatDigitada] = useState("");
  const [lonDigitada, setLonDigitada] = useState("");
  const [erroCoordenada, setErroCoordenada] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/mapa-irrigacao/`)
      .then(async (resposta) => {
        const json = await resposta.json();
        if (!resposta.ok) throw new Error(json.erro ?? "Erro ao carregar o mapa.");
        setGrade(json);
      })
      .catch((e) => setErroGrade(e instanceof Error ? e.message : "Erro desconhecido."));
  }, []);

  const buscarClima = useCallback(async (lat: number, lon: number) => {
    setPosicao([lat, lon]);
    setDados(null);
    setErro(null);
    setCarregando(true);
    try {
      const resposta = await fetch(
        `${API_URL}/clima/?lat=${lat}&lon=${lon}`
      );
      const json = await resposta.json();
      if (!resposta.ok) {
        throw new Error(json.erro ?? "Erro ao buscar dados climáticos.");
      }
      setDados(json);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro desconhecido.");
    } finally {
      setCarregando(false);
    }
  }, []);

  const irParaCoordenada = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const lat = parseFloat(latDigitada.replace(",", "."));
      const lon = parseFloat(lonDigitada.replace(",", "."));

      if (Number.isNaN(lat) || Number.isNaN(lon)) {
        setErroCoordenada("Digite latitude e longitude válidas.");
        return;
      }

      setErroCoordenada(null);
      const mapa = mapaRef.current;
      if (mapa) {
        mapa.flyTo([lat, lon], Math.max(mapa.getZoom(), ZOOM_AO_IR_PARA_PONTO), {
          duration: 1,
        });
      }
      buscarClima(lat, lon);
    },
    [latDigitada, lonDigitada, buscarClima]
  );

  return (
    <div className="relative h-full w-full">
      <MapContainer
        ref={mapaRef}
        bounds={LIMITES_RO}
        boundsOptions={{ padding: [24, 24] }}
        minZoom={6}
        maxBounds={LIMITES_RO}
        maxBoundsViscosity={1.0}
        className="h-full w-full"
        style={{ background: "#f9f9f7" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {grade && <CamadaEstadoColorido grade={grade} metrica={metrica} />}
        <SeletorDeLocal onSelecionar={buscarClima} />
        {posicao && (
          <Marker position={posicao} icon={iconeMarcador}>
            <Popup>
              {posicao[0].toFixed(4)}, {posicao[1].toFixed(4)}
            </Popup>
          </Marker>
        )}
      </MapContainer>

      <div className="absolute top-20 left-4 z-[1000] w-56 rounded-lg bg-white/95 p-2.5 shadow-lg backdrop-blur">
        <div className="flex flex-wrap gap-1">
          {OPCOES_METRICA.map((op) => (
            <button
              key={op.valor}
              onClick={() => setMetrica(op.valor)}
              className={`rounded px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                metrica === op.valor
                  ? "bg-slate-800 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {op.rotulo}
            </button>
          ))}
        </div>

        {erroGrade && <p className="mt-1.5 text-xs text-red-600">{erroGrade}</p>}

        {!erroGrade && !grade && (
          <p className="mt-1.5 text-xs text-slate-400">Carregando mapa...</p>
        )}

        {grade && (
          <div className="mt-1.5 text-[10px] text-slate-400">
            {LEGENDAS[metrica] && (
              <div className="flex items-center gap-1.5">
                <span>{LEGENDAS[metrica]!.minimo}</span>
                <span className="flex h-2 w-24 overflow-hidden rounded-full">
                  {LEGENDAS[metrica]!.rampa.map((cor) => (
                    <span key={cor} className="h-full flex-1" style={{ backgroundColor: cor }} />
                  ))}
                </span>
                <span>{LEGENDAS[metrica]!.maximo}</span>
              </div>
            )}

            {metrica === "irrigacao" && (
              <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                {Object.values(STATUS_IRRIGACAO).map((s) => (
                  <span key={s.rotulo} className="flex items-center gap-1">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: s.cor }}
                    />
                    {s.rotulo}
                  </span>
                ))}
              </div>
            )}

            {metrica === "vento_direcao" && (
              <p>↑ aponta para onde o vento sopra · cor = intensidade</p>
            )}
            {grade.data && <p className="mt-1">Referência: {grade.data}</p>}
          </div>
        )}
      </div>

      <form
        onSubmit={irParaCoordenada}
        className="absolute bottom-4 left-4 z-[1000] w-56 rounded-lg bg-white/95 p-2.5 shadow-lg backdrop-blur"
      >
        <p className="mb-1.5 text-xs font-semibold text-slate-500">Ir para coordenada</p>
        <div className="flex gap-1">
          <input
            type="text"
            inputMode="decimal"
            placeholder="Latitude"
            value={latDigitada}
            onChange={(e) => setLatDigitada(e.target.value)}
            className="w-full min-w-0 rounded border border-slate-200 px-1.5 py-1 text-xs"
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="Longitude"
            value={lonDigitada}
            onChange={(e) => setLonDigitada(e.target.value)}
            className="w-full min-w-0 rounded border border-slate-200 px-1.5 py-1 text-xs"
          />
        </div>
        <button
          type="submit"
          className="mt-1.5 w-full rounded bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700"
        >
          Ir
        </button>
        {erroCoordenada && <p className="mt-1 text-[10px] text-red-600">{erroCoordenada}</p>}
      </form>

      <div className="absolute top-4 right-4 z-[1000] max-h-[calc(100%-2rem)] w-[26rem] max-w-[92vw] overflow-y-auto rounded-lg bg-white/95 p-4 shadow-lg backdrop-blur">
        <h2 className="mb-2 text-lg font-semibold text-slate-800">
          Painel Climático — Rondônia
        </h2>

        {!posicao && (
          <p className="text-sm text-slate-500">
            Clique em um ponto do mapa para ver os dados climáticos do local.
          </p>
        )}

        {carregando && <p className="text-sm text-slate-500">Carregando...</p>}

        {erro && <p className="text-sm text-red-600">{erro}</p>}

        {dados && !carregando && (
          <div className="space-y-3 text-sm text-slate-700">
            <div>
              <p className="text-xs text-slate-400">
                Lat {dados.localizacao.lat.toFixed(4)}, Lon{" "}
                {dados.localizacao.lon.toFixed(4)}
              </p>
              <p className="text-3xl font-bold text-slate-800">
                {dados.atual.temperature_2m.toFixed(1)}°C
              </p>
              <p className="text-slate-500">
                Sensação: {dados.atual.apparent_temperature.toFixed(1)}°C
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded bg-slate-100 p-2">
                <p className="text-xs text-slate-400">Umidade</p>
                <p className="font-medium">
                  {dados.atual.relative_humidity_2m}%
                </p>
              </div>
              <div className="rounded bg-slate-100 p-2">
                <p className="text-xs text-slate-400">Vento</p>
                <p className="font-medium">
                  {dados.atual.wind_speed_10m} km/h
                </p>
              </div>
              <div className="rounded bg-slate-100 p-2">
                <p className="text-xs text-slate-400">Precipitação</p>
                <p className="font-medium">{dados.atual.precipitation} mm</p>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold text-slate-400">
                Temperatura
              </p>
              <ul className="flex gap-1 overflow-x-auto pb-1">
                {dados.previsao_diaria.time.map((dia, i) => (
                  <li
                    key={dia}
                    className="flex shrink-0 flex-col items-center rounded bg-slate-50 px-2 py-1 text-center"
                  >
                    <span className="text-[10px] text-slate-400">
                      {rotuloDiaAbs(dia, i)}
                    </span>
                    <span className="text-xs font-medium">
                      {dados.previsao_diaria.temperature_2m_min[i].toFixed(0)}°/
                      {dados.previsao_diaria.temperature_2m_max[i].toFixed(0)}°
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <IrrigacaoHeatmap previsao={dados.previsao_diaria} />
          </div>
        )}
      </div>
    </div>
  );
}
