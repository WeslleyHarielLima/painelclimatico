export function rotuloDiaAbs(dataIso: string, indiceAbsoluto: number): string {
  if (indiceAbsoluto === 0) return "Hoje";
  if (indiceAbsoluto === 1) return "Amanhã";
  if (indiceAbsoluto === 2) return "Depois de amanhã";
  const rotulo = new Date(dataIso).toLocaleDateString("pt-BR", {
    weekday: "short",
  });
  return rotulo.charAt(0).toUpperCase() + rotulo.slice(1).replace(".", "");
}
