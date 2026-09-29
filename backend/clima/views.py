import time

import requests
from rest_framework.decorators import api_view
from rest_framework.response import Response

# Bounding box aproximado do estado de Rondônia (RO)
RO_BOUNDS = {
    "lat_min": -13.7,
    "lat_max": -7.9,
    "lon_min": -66.8,
    "lon_max": -59.7,
}

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
IBGE_MALHA_URL = "https://servicodados.ibge.gov.br/api/v3/malhas/estados/11"

# Velocidade de vento acima da qual a irrigação por aspersão perde eficiência
# (deriva/evaporação excessiva) e deve ser evitada.
VENTO_ALERTA_KMH = 20.0

# Espaçamento (graus) da grade de amostragem usada no mapa colorido do estado.
# Mais espaçado = pontos mais suaves de interpolar visualmente no heatmap.
GRADE_PASSO_GRAUS = 0.6

# Cache em memória do processo: o contorno do estado e o anel de coordenadas
# usado no teste ponto-em-polígono. Não muda entre requisições.
_poligono_cache: dict | None = None
_anel_cache: list | None = None

# Cache da grade de irrigação (todo o estado muda pouco dentro do mesmo dia).
_grade_cache: dict | None = None
_grade_cache_timestamp: float = 0.0
GRADE_CACHE_TTL_SEGUNDOS = 15 * 60


def _dentro_de_rondonia(lat: float, lon: float) -> bool:
    return (
        RO_BOUNDS["lat_min"] <= lat <= RO_BOUNDS["lat_max"]
        and RO_BOUNDS["lon_min"] <= lon <= RO_BOUNDS["lon_max"]
    )


def _obter_poligono_rondonia() -> tuple[dict, list]:
    """Busca (e cacheia em memória) o contorno oficial de Rondônia via IBGE."""
    global _poligono_cache, _anel_cache
    if _poligono_cache is not None and _anel_cache is not None:
        return _poligono_cache, _anel_cache

    resposta = requests.get(
        IBGE_MALHA_URL,
        params={"formato": "application/vnd.geo+json", "qualidade": "intermediaria"},
        timeout=15,
    )
    resposta.raise_for_status()
    geojson = resposta.json()
    anel = geojson["features"][0]["geometry"]["coordinates"][0]  # [lon, lat]

    _poligono_cache = geojson
    _anel_cache = anel
    return geojson, anel


def _ponto_dentro_do_poligono(lat: float, lon: float, anel: list) -> bool:
    """Ray casting clássico: anel é uma lista de [lon, lat]."""
    dentro = False
    n = len(anel)
    j = n - 1
    for i in range(n):
        xi, yi = anel[i]
        xj, yj = anel[j]
        intersecta = ((yi > lat) != (yj > lat)) and (
            lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-15) + xi
        )
        if intersecta:
            dentro = not dentro
        j = i
    return dentro


def _gerar_grade_pontos(anel: list) -> list[tuple[float, float]]:
    pontos = []
    lat = RO_BOUNDS["lat_min"]
    while lat <= RO_BOUNDS["lat_max"]:
        lon = RO_BOUNDS["lon_min"]
        while lon <= RO_BOUNDS["lon_max"]:
            if _ponto_dentro_do_poligono(lat, lon, anel):
                pontos.append((round(lat, 4), round(lon, 4)))
            lon += GRADE_PASSO_GRAUS
        lat += GRADE_PASSO_GRAUS
    return pontos


def _categoria_irrigacao(necessidade_mm: float) -> str:
    if necessidade_mm <= 0.5:
        return "nao_irrigar"
    if necessidade_mm <= 2:
        return "leve"
    if necessidade_mm <= 4:
        return "moderada"
    return "alta"


def _calcular_irrigacao(diaria: dict) -> dict:
    """
    Calcula o balanço hídrico diário (ET0 - chuva) para orientar a irrigação.

    ET0 (evapotranspiração de referência, método FAO-56 Penman-Monteith) é a
    quantidade de água, em mm, que a atmosfera "puxa" do solo/planta num dia.
    Quando a chuva prevista não cobre esse valor, falta água -> é preciso irrigar
    a diferença. Referência: FAO Irrigation and Drainage Paper 56.
    """
    et0 = diaria.get("et0_fao_evapotranspiration", [])
    chuva = diaria.get("precipitation_sum", [])
    vento_max = diaria.get("wind_speed_10m_max", [])

    necessidade_irrigacao_mm = []
    categoria_irrigacao = []
    alerta_vento = []

    for i in range(len(diaria.get("time", []))):
        balanco = round((et0[i] if i < len(et0) else 0) - (chuva[i] if i < len(chuva) else 0), 1)
        necessidade = max(balanco, 0)
        necessidade_irrigacao_mm.append(necessidade)
        categoria_irrigacao.append(_categoria_irrigacao(necessidade))
        alerta_vento.append(bool(i < len(vento_max) and vento_max[i] >= VENTO_ALERTA_KMH))

    return {
        "necessidade_irrigacao_mm": necessidade_irrigacao_mm,
        "categoria_irrigacao": categoria_irrigacao,
        "alerta_vento": alerta_vento,
    }


@api_view(["GET"])
def clima_localizacao(request):
    lat = request.query_params.get("lat")
    lon = request.query_params.get("lon")

    if lat is None or lon is None:
        return Response({"erro": "Parâmetros 'lat' e 'lon' são obrigatórios."}, status=400)

    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except ValueError:
        return Response({"erro": "'lat' e 'lon' devem ser números."}, status=400)

    if not _dentro_de_rondonia(lat_f, lon_f):
        return Response(
            {"erro": "Localização fora dos limites do estado de Rondônia."}, status=400
        )

    params = {
        "latitude": lat_f,
        "longitude": lon_f,
        "current": [
            "temperature_2m",
            "relative_humidity_2m",
            "apparent_temperature",
            "precipitation",
            "weather_code",
            "wind_speed_10m",
            "wind_direction_10m",
        ],
        "daily": [
            "temperature_2m_max",
            "temperature_2m_min",
            "precipitation_sum",
            "precipitation_probability_max",
            "wind_speed_10m_max",
            "wind_gusts_10m_max",
            "relative_humidity_2m_mean",
            "et0_fao_evapotranspiration",
            "weather_code",
        ],
        "timezone": "America/Porto_Velho",
        "forecast_days": 8,
    }

    try:
        resposta = requests.get(OPEN_METEO_URL, params=params, timeout=10)
        resposta.raise_for_status()
    except requests.RequestException:
        return Response(
            {"erro": "Não foi possível obter dados climáticos no momento."}, status=502
        )

    dados = resposta.json()
    diaria = dados.get("daily", {})
    diaria = {**diaria, **_calcular_irrigacao(diaria)}

    return Response(
        {
            "localizacao": {"lat": lat_f, "lon": lon_f},
            "atual": dados.get("current"),
            "previsao_diaria": diaria,
            "unidades": {
                "atual": dados.get("current_units"),
                "diaria": {
                    **dados.get("daily_units", {}),
                    "necessidade_irrigacao_mm": "mm",
                },
            },
        }
    )


@api_view(["GET"])
def mapa_irrigacao(request):
    """
    Grade de pontos cobrindo Rondônia com dados climáticos do dia, para
    colorir o mapa inteiro (não apenas o ponto clicado).
    """
    global _grade_cache, _grade_cache_timestamp

    agora = time.time()
    if _grade_cache is not None and (agora - _grade_cache_timestamp) < GRADE_CACHE_TTL_SEGUNDOS:
        return Response(_grade_cache)

    try:
        poligono, anel = _obter_poligono_rondonia()
    except requests.RequestException:
        return Response(
            {"erro": "Não foi possível obter o contorno de Rondônia (IBGE)."}, status=502
        )

    pontos = _gerar_grade_pontos(anel)

    params = {
        "latitude": ",".join(str(p[0]) for p in pontos),
        "longitude": ",".join(str(p[1]) for p in pontos),
        "daily": [
            "precipitation_sum",
            "wind_speed_10m_max",
            "wind_direction_10m_dominant",
            "relative_humidity_2m_mean",
            "temperature_2m_mean",
            "et0_fao_evapotranspiration",
        ],
        "timezone": "America/Porto_Velho",
        "forecast_days": 1,
    }

    try:
        resposta = requests.get(OPEN_METEO_URL, params=params, timeout=30)
        resposta.raise_for_status()
    except requests.RequestException:
        return Response(
            {"erro": "Não foi possível obter dados climáticos no momento."}, status=502
        )

    resultados = resposta.json()
    if isinstance(resultados, dict):
        # Open-Meteo retorna um objeto único (em vez de lista) quando só há 1 ponto.
        resultados = [resultados]

    celulas = []
    for (lat, lon), item in zip(pontos, resultados):
        diaria = item.get("daily", {})

        def _v(chave):
            valores = diaria.get(chave) or []
            return valores[0] if valores else None

        chuva = _v("precipitation_sum")
        vento = _v("wind_speed_10m_max")
        vento_direcao = _v("wind_direction_10m_dominant")
        umidade = _v("relative_humidity_2m_mean")
        temperatura = _v("temperature_2m_mean")
        et0 = _v("et0_fao_evapotranspiration")

        if chuva is None or et0 is None:
            continue

        necessidade = max(round(et0 - chuva, 1), 0)

        celulas.append(
            {
                "lat": lat,
                "lon": lon,
                "chuva_mm": chuva,
                "vento_kmh": vento,
                "vento_direcao_graus": vento_direcao,
                "umidade_pct": umidade,
                "temperatura_c": temperatura,
                "necessidade_irrigacao_mm": necessidade,
                "categoria_irrigacao": _categoria_irrigacao(necessidade),
            }
        )

    data_referencia = None
    if resultados:
        tempos = resultados[0].get("daily", {}).get("time") or []
        data_referencia = tempos[0] if tempos else None

    _grade_cache = {
        "poligono": poligono,
        "passo_graus": GRADE_PASSO_GRAUS,
        "data": data_referencia,
        "celulas": celulas,
    }
    _grade_cache_timestamp = agora

    return Response(_grade_cache)
