# Painel Climático — Rondônia

Mapa climático interativo do estado de Rondônia: clique em um ponto do mapa e veja a previsão do tempo daquele local em tempo real.

## Stack

- **Frontend**: Next.js (App Router) + React-Leaflet + Tailwind CSS
- **Backend**: Django + Django REST Framework
- **Dados climáticos**: [Open-Meteo](https://open-meteo.com/) (gratuita, sem necessidade de chave de API)

## Como rodar

### Backend

```bash
cd backend
venv\Scripts\activate      # Windows
python manage.py runserver 8000
```

API disponível em `http://127.0.0.1:8000/api/clima/?lat=-8.76&lon=-63.90`.

### Frontend

```bash
cd frontend
npm run dev
```

Acesse `http://localhost:3000` (ou a porta indicada no terminal).

Configuração da URL da API em `frontend/.env.local` (`NEXT_PUBLIC_API_URL`).

## Como funciona

1. O mapa é restrito ao bounding box de Rondônia (`frontend/src/components/MapaClimatico.tsx`).
2. Ao clicar no mapa, o frontend chama `GET /api/clima/?lat=...&lon=...` no backend.
3. O backend (`backend/clima/views.py`) valida se o ponto está dentro de Rondônia, consulta a Open-Meteo e retorna os dados normalizados (condição atual + previsão de 8 dias).

## Heatmap de irrigação

Cada dia da previsão traz chuva, vento, umidade e a **necessidade de irrigação**,
calculada pelo balanço hídrico padrão da agronomia (FAO Irrigation and Drainage
Paper 56):

```
necessidade_irrigação (mm) = max(ET0 − chuva_prevista, 0)
```

- **ET0** (evapotranspiração de referência, método Penman-Monteith) já vem pronta
  da Open-Meteo (`et0_fao_evapotranspiration`) — é quanto de água a atmosfera
  "puxa" do solo/planta naquele dia.
- Se a chuva prevista cobre o ET0, o balanço fica ≤ 0 → **não irrigar**.
- Se falta água, o valor positivo vira a categoria leve/moderada/alta
  (`backend/clima/views.py::_categoria_irrigacao`).
- Ventos acima de 20 km/h disparam um alerta de "vento forte" (irrigação por
  aspersão perde eficiência com vento forte — deriva e evaporação).

O heatmap (`frontend/src/components/IrrigacaoHeatmap.tsx`) colore cada célula
por magnitude (rampas sequenciais claro→escuro para chuva/vento/umidade,
geradas em OKLCH a partir da paleta base — ver
`frontend/src/components/heatmapColors.ts`) e usa uma paleta de status fixa
(verde/amarelo/laranja/vermelho, sempre com ícone + texto) para a recomendação
final de irrigação.

## Próximos passos sugeridos

- Trocar o bounding box retangular pelo polígono real do estado (GeoJSON do IBGE) para recorte mais preciso.
- Adicionar cache no backend (ex: Redis) para reduzir chamadas repetidas à Open-Meteo.
- Trocar fonte de dados por INMET caso precise de dados oficiais brasileiros.
- Deploy: frontend na Vercel, backend em qualquer host com suporte a Django (Railway, Render, etc.).
