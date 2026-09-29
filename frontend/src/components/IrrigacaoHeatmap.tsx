"use client";

import { corChuva, corVento, corUmidade, STATUS_IRRIGACAO } from "./heatmapColors";
import { rotuloDiaAbs } from "./previsaoUtils";

export interface PrevisaoDiaria {
  time: string[];
  precipitation_sum: number[];
  wind_speed_10m_max: number[];
  relative_humidity_2m_mean: number[];
  necessidade_irrigacao_mm: number[];
  categoria_irrigacao: string[];
  alerta_vento: boolean[];
}

function Celula({
  valor,
  unidade,
  cor,
}: {
  valor: number;
  unidade: string;
  cor: { fundo: string; texto: string };
}) {
  return (
    <td className="p-0.5">
      <div
        className="rounded px-1.5 py-1 text-center text-xs font-medium tabular-nums"
        style={{ backgroundColor: cor.fundo, color: cor.texto }}
      >
        {valor}
        <span className="opacity-80">{unidade}</span>
      </div>
    </td>
  );
}

export default function IrrigacaoHeatmap({ previsao }: { previsao: PrevisaoDiaria }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <p className="text-xs font-semibold text-slate-500">
          Irrigação — próximos dias
        </p>
        <p className="text-[10px] text-slate-400">
          balanço = ET0 − chuva (FAO-56)
        </p>
      </div>

      <div className="max-h-64 overflow-y-auto rounded border border-slate-200">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="text-[10px] uppercase tracking-wide text-slate-400">
              <th className="p-1 text-left font-medium">Dia</th>
              <th className="p-1 font-medium">Chuva</th>
              <th className="p-1 font-medium">Vento</th>
              <th className="p-1 font-medium">Umid.</th>
              <th className="p-1 text-left font-medium">Irrigação</th>
            </tr>
          </thead>
          <tbody>
            {previsao.time.map((dia, i) => {
              const chuva = previsao.precipitation_sum[i];
              const vento = previsao.wind_speed_10m_max[i];
              const umidade = previsao.relative_humidity_2m_mean[i];
              const categoria = previsao.categoria_irrigacao[i];
              const status = STATUS_IRRIGACAO[categoria];
              const ventoForte = previsao.alerta_vento[i];

              return (
                <tr key={dia} className="border-t border-slate-100">
                  <td className="whitespace-nowrap p-1 text-xs text-slate-600">
                    {rotuloDiaAbs(dia, i)}
                  </td>
                  <Celula valor={chuva} unidade="mm" cor={corChuva(chuva)} />
                  <Celula valor={vento} unidade="" cor={corVento(vento)} />
                  <Celula valor={umidade} unidade="%" cor={corUmidade(umidade)} />
                  <td className="p-0.5">
                    <div className="flex flex-col gap-0.5">
                      <span
                        className="inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
                        style={{ backgroundColor: status.cor, color: status.corTexto }}
                      >
                        <span aria-hidden>{status.icone}</span>
                        {status.rotulo}
                      </span>
                      {ventoForte && (
                        <span
                          className="inline-flex w-fit items-center gap-1 rounded bg-[#fab219] px-1.5 py-0.5 text-[10px] font-medium text-[#1a1a19]"
                          title="Vento forte: evite irrigação por aspersão (perdas por deriva/evaporação)"
                        >
                          <span aria-hidden>⚠</span>
                          Vento forte
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
        <span>Chuva/Vento/Umidade: claro → escuro = pouco → muito</span>
      </div>
    </div>
  );
}
