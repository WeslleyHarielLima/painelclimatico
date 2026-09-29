from django.urls import path

from . import views

urlpatterns = [
    path("clima/", views.clima_localizacao, name="clima_localizacao"),
    path("mapa-irrigacao/", views.mapa_irrigacao, name="mapa_irrigacao"),
]
