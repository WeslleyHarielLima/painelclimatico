// Rampas sequenciais (uma matiz, 5 níveis, claro -> escuro) derivadas em OKLCH
// a partir da paleta de referência: mesma trajetória de luminância da rampa
// azul, aplicada às matizes de vento (laranja) e umidade (verde-água).
// Cada rampa representa magnitude (quanto maior o valor, mais escura a célula).

export const RAMPA_CHUVA = ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"];
export const RAMPA_VENTO = ["#fbd7ca", "#eb9c7f", "#d95923", "#a03400", "#631b00"];
export const RAMPA_UMIDADE = ["#cce8d9", "#80c3a2", "#00a06c", "#007248", "#004529"];
export const RAMPA_TEMPERATURA = ["#fed4d0", "#f2958e", "#e24a49", "#a72528", "#681014"];

// Paleta de status fixa (nunca reutilizada para outra coisa): estado da
// recomendação de irrigação, sempre acompanhada de ícone + rótulo.
export const STATUS_IRRIGACAO: Record<
  string,
  { cor: string; corTexto: string; rotulo: string; icone: string }
> = {
  nao_irrigar: { cor: "#0ca30c", corTexto: "#ffffff", rotulo: "Não irrigar", icone: "✓" },
  leve: { cor: "#fab219", corTexto: "#1a1a19", rotulo: "Leve", icone: "○" },
  moderada: { cor: "#ec835a", corTexto: "#ffffff", rotulo: "Moderada", icone: "◐" },
  alta: { cor: "#d03b3b", corTexto: "#ffffff", rotulo: "Alta", icone: "●" },
};

function nivel(valor: number, limites: number[]): number {
  for (let i = 0; i < limites.length; i++) {
    if (valor <= limites[i]) return i;
  }
  return limites.length;
}

// Texto escuro nos tons claros (níveis 0-1), texto branco nos tons escuros (níveis 2-4).
function corTextoParaNivel(n: number): string {
  return n <= 1 ? "#1a1a19" : "#ffffff";
}

export function corChuva(mm: number) {
  const n = nivel(mm, [0.2, 2, 8, 20]);
  return { fundo: RAMPA_CHUVA[n], texto: corTextoParaNivel(n) };
}

export function corVento(kmh: number) {
  const n = nivel(kmh, [10, 20, 30, 40]);
  return { fundo: RAMPA_VENTO[n], texto: corTextoParaNivel(n) };
}

export function corUmidade(pct: number) {
  const n = nivel(pct, [40, 55, 70, 85]);
  return { fundo: RAMPA_UMIDADE[n], texto: corTextoParaNivel(n) };
}

export function corTemperatura(celsius: number) {
  const n = nivel(celsius, [24, 27, 30, 33]);
  return { fundo: RAMPA_TEMPERATURA[n], texto: corTextoParaNivel(n) };
}

// --- Interpolação contínua (usada no raster suave do mapa do estado) ---
// Ao contrário das rampas discretas acima (5 faixas fixas), aqui o valor é
// mapeado para um ponto contínuo entre duas cores vizinhas — sem "degraus".

function hexParaRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function misturarHex(a: string, b: string, t: number): [number, number, number] {
  const [r1, g1, b1] = hexParaRgb(a);
  const [r2, g2, b2] = hexParaRgb(b);
  return [r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t];
}

/** Interpola `valor` entre os `stops` (mesmo tamanho de `cores`), devolvendo [r,g,b]. */
export function corInterpoladaRgb(
  valor: number,
  stops: number[],
  cores: string[]
): [number, number, number] {
  if (valor <= stops[0]) return hexParaRgb(cores[0]);
  const ultimo = stops.length - 1;
  if (valor >= stops[ultimo]) return hexParaRgb(cores[cores.length - 1]);
  for (let i = 0; i < ultimo; i++) {
    if (valor <= stops[i + 1]) {
      const t = (valor - stops[i]) / (stops[i + 1] - stops[i]);
      return misturarHex(cores[i], cores[i + 1], t);
    }
  }
  return hexParaRgb(cores[cores.length - 1]);
}

export interface EscalaContinua {
  stops: number[];
  cores: string[];
}

// Mesmas faixas de valor das rampas discretas acima, mas com uma âncora
// inicial para dar uma inclinação suave também abaixo do primeiro limiar.
export const ESCALA_CHUVA: EscalaContinua = { stops: [0, 0.2, 2, 8, 20], cores: RAMPA_CHUVA };
export const ESCALA_VENTO: EscalaContinua = { stops: [0, 10, 20, 30, 40], cores: RAMPA_VENTO };
export const ESCALA_UMIDADE: EscalaContinua = {
  stops: [20, 40, 55, 70, 85],
  cores: RAMPA_UMIDADE,
};
export const ESCALA_TEMPERATURA: EscalaContinua = {
  stops: [20, 24, 27, 30, 33],
  cores: RAMPA_TEMPERATURA,
};
export const ESCALA_IRRIGACAO: EscalaContinua = {
  stops: [0, 0.5, 2, 4],
  cores: [
    STATUS_IRRIGACAO.nao_irrigar.cor,
    STATUS_IRRIGACAO.leve.cor,
    STATUS_IRRIGACAO.moderada.cor,
    STATUS_IRRIGACAO.alta.cor,
  ],
};
