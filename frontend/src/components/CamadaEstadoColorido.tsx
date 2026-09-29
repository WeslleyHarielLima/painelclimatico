"use client";

import { useMemo, useRef } from "react";
import { CircleMarker, ImageOverlay, Marker, Polygon, Tooltip } from "react-leaflet";
import L from "leaflet";
import type { LatLngExpression, LatLngBoundsExpression } from "leaflet";
import {
  corVento,
  STATUS_IRRIGACAO,
  corInterpoladaRgb,
  ESCALA_CHUVA,
  ESCALA_VENTO,
  ESCALA_UMIDADE,
  ESCALA_TEMPERATURA,
  ESCALA_IRRIGACAO,
  type EscalaContinua,
} from "./heatmapColors";

export interface CelulaGrade {
  lat: number;
  lon: number;
  chuva_mm: number;
  vento_kmh: number;
  vento_direcao_graus: number | null;
  umidade_pct: number;
  temperatura_c: number;
  necessidade_irrigacao_mm: number;
  categoria_irrigacao: string;
}

export interface GradeIrrigacao {
  poligono: { features: { geometry: { coordinates: [number, number][][] } }[] };
  passo_graus: number;
  data: string | null;
  celulas: CelulaGrade[];
}

export type Metrica =
  | "chuva"
  | "vento"
  | "vento_direcao"
  | "umidade"
  | "temperatura"
  | "irrigacao";

// Cobre uma área bem maior que Rondônia para funcionar como "máscara":
// a área fora do estado fica pintada com a cor de fundo do mapa, deixando
// só a silhueta de Rondônia colorida.
const ANEL_MUNDO: LatLngExpression[] = [
  [85, -175],
  [85, 175],
  [-85, 175],
  [-85, -175],
];

// Resolução do raster interpolado (pixels no lado mais largo). Maior = mais
// detalhe, mas mais custo de cálculo ao trocar de camada.
const RESOLUCAO_RASTER = 220;
const OPACIDADE_RASTER = 0.55;

interface ConfigMetrica {
  escala: EscalaContinua;
  valor: (c: CelulaGrade) => number;
}

const CONFIG_METRICA: Record<Exclude<Metrica, "vento_direcao">, ConfigMetrica> = {
  chuva: { escala: ESCALA_CHUVA, valor: (c) => c.chuva_mm },
  vento: { escala: ESCALA_VENTO, valor: (c) => c.vento_kmh },
  umidade: { escala: ESCALA_UMIDADE, valor: (c) => c.umidade_pct },
  temperatura: { escala: ESCALA_TEMPERATURA, valor: (c) => c.temperatura_c },
  irrigacao: { escala: ESCALA_IRRIGACAO, valor: (c) => c.necessidade_irrigacao_mm },
};

function bboxDoAnel(anel: LatLngExpression[]): LatLngBoundsExpression {
  let latMin = Infinity,
    latMax = -Infinity,
    lonMin = Infinity,
    lonMax = -Infinity;
  for (const ponto of anel) {
    const [lat, lon] = ponto as [number, number];
    if (lat < latMin) latMin = lat;
    if (lat > latMax) latMax = lat;
    if (lon < lonMin) lonMin = lon;
    if (lon > lonMax) lonMax = lon;
  }
  return [
    [latMin, lonMin],
    [latMax, lonMax],
  ];
}

/**
 * Gera uma imagem (data URL) interpolando os valores da grade por IDW
 * (inverse distance weighting — cada pixel é a média dos pontos vizinhos,
 * ponderada pelo inverso do quadrado da distância). Diferente de pintar
 * círculos semi-transparentes sobrepostos, aqui o VALOR é interpolado uma
 * única vez por pixel antes de virar cor — não há acúmulo de opacidade nas
 * áreas onde células "se encontram", então a cor ali continua fiel ao dado.
 */
function gerarRasterIDW(
  celulas: CelulaGrade[],
  bbox: [[number, number], [number, number]],
  config: ConfigMetrica
): string {
  const [[latMin, lonMin], [latMax, lonMax]] = bbox;
  const latSpan = latMax - latMin;
  const lonSpan = lonMax - lonMin;
  const larguraPx = RESOLUCAO_RASTER;
  const alturaPx = Math.max(1, Math.round(RESOLUCAO_RASTER * (latSpan / lonSpan)));

  // Corrige a distorção: 1° de longitude equivale a menos km que 1° de
  // latitude, tanto mais quanto mais perto dos polos (fator cos(latitude)).
  const fatorLon = Math.cos(((latMin + latMax) / 2) * (Math.PI / 180));

  const pontos = celulas.map((c) => ({
    lat: c.lat,
    lon: c.lon,
    valor: config.valor(c),
  }));

  const canvas = document.createElement("canvas");
  canvas.width = larguraPx;
  canvas.height = alturaPx;
  const ctx = canvas.getContext("2d")!;
  const imagem = ctx.createImageData(larguraPx, alturaPx);
  const alfa = Math.round(OPACIDADE_RASTER * 255);

  for (let py = 0; py < alturaPx; py++) {
    const lat = latMax - (py / Math.max(1, alturaPx - 1)) * latSpan;
    for (let px = 0; px < larguraPx; px++) {
      const lon = lonMin + (px / Math.max(1, larguraPx - 1)) * lonSpan;

      let numerador = 0;
      let denominador = 0;
      let valorExato: number | null = null;

      for (const ponto of pontos) {
        const dLat = lat - ponto.lat;
        const dLon = (lon - ponto.lon) * fatorLon;
        const d2 = dLat * dLat + dLon * dLon;
        if (d2 < 1e-8) {
          valorExato = ponto.valor;
          break;
        }
        const peso = 1 / d2;
        numerador += peso * ponto.valor;
        denominador += peso;
      }

      const valor = valorExato ?? numerador / denominador;
      const [r, g, b] = corInterpoladaRgb(valor, config.escala.stops, config.escala.cores);

      const i = (py * larguraPx + px) * 4;
      imagem.data[i] = r;
      imagem.data[i + 1] = g;
      imagem.data[i + 2] = b;
      imagem.data[i + 3] = alfa;
    }
  }

  ctx.putImageData(imagem, 0, 0);
  return canvas.toDataURL();
}

function iconeSeta(direcaoGraus: number, cor: string) {
  // wind_direction_10m_dominant é de onde o vento vem; soma-se 180° para a
  // seta apontar para onde o vento sopra (convenção de mapas de vento).
  const rotacao = (direcaoGraus + 180) % 360;
  return L.divIcon({
    className: "",
    html: `<div style="transform: rotate(${rotacao}deg); color: ${cor}; font-size: 20px; line-height: 1; text-shadow: 0 0 2px white, 0 0 2px white;">↑</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function TooltipDaCelula({ celula }: { celula: CelulaGrade }) {
  return (
    <Tooltip sticky>
      <div className="text-xs">
        <div>Temperatura: {celula.temperatura_c}°C</div>
        <div>Chuva: {celula.chuva_mm} mm</div>
        <div>
          Vento: {celula.vento_kmh} km/h
          {celula.vento_direcao_graus !== null && ` (${celula.vento_direcao_graus}°)`}
        </div>
        <div>Umidade: {celula.umidade_pct}%</div>
        <div>Irrigação: {STATUS_IRRIGACAO[celula.categoria_irrigacao]?.rotulo}</div>
      </div>
    </Tooltip>
  );
}

export default function CamadaEstadoColorido({
  grade,
  metrica,
}: {
  grade: GradeIrrigacao;
  metrica: Metrica;
}) {
  const anelEstado: LatLngExpression[] = grade.poligono.features[0].geometry.coordinates[0].map(
    ([lon, lat]) => [lat, lon]
  );

  const bbox = useMemo(
    () => bboxDoAnel(anelEstado) as [[number, number], [number, number]],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grade]
  );

  // Cacheia o raster de cada métrica já calculada, para trocar de camada
  // instantaneamente ao voltar para uma métrica vista antes nesta sessão.
  const cacheRaster = useRef<Partial<Record<Metrica, string>>>({});

  const rasterUrl = useMemo(() => {
    if (metrica === "vento_direcao") return null;
    if (cacheRaster.current[metrica]) return cacheRaster.current[metrica]!;
    const url = gerarRasterIDW(grade.celulas, bbox, CONFIG_METRICA[metrica]);
    cacheRaster.current[metrica] = url;
    return url;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade, metrica, bbox]);

  return (
    <>
      {metrica === "vento_direcao" ? (
        grade.celulas
          .filter((c) => c.vento_direcao_graus !== null)
          .map((celula) => (
            <Marker
              key={`${celula.lat}-${celula.lon}`}
              position={[celula.lat, celula.lon]}
              icon={iconeSeta(celula.vento_direcao_graus!, corVento(celula.vento_kmh).fundo)}
              interactive={true}
            >
              <TooltipDaCelula celula={celula} />
            </Marker>
          ))
      ) : (
        <ImageOverlay url={rasterUrl!} bounds={bbox} interactive={false} />
      )}

      {/* Alvos invisíveis para o hover mostrar os valores exatos de cada ponto. */}
      {metrica !== "vento_direcao" &&
        grade.celulas.map((celula) => (
          <CircleMarker
            key={`${celula.lat}-${celula.lon}`}
            center={[celula.lat, celula.lon]}
            radius={16}
            pathOptions={{ opacity: 0, fillOpacity: 0 }}
          >
            <TooltipDaCelula celula={celula} />
          </CircleMarker>
        ))}

      {/* Máscara: esconde o raster fora do contorno oficial do estado. */}
      <Polygon
        positions={[ANEL_MUNDO, anelEstado]}
        pathOptions={{ color: "transparent", fillColor: "#f9f9f7", fillOpacity: 1, weight: 0 }}
        interactive={false}
      />

      {/* Contorno nítido do estado por cima da grade colorida. */}
      <Polygon
        positions={anelEstado}
        pathOptions={{ color: "#383835", weight: 2, fill: false }}
        interactive={false}
      />
    </>
  );
}
