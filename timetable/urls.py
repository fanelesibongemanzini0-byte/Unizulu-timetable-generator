from django.urls import path, include
from. import views

from django.urls import path
from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("api/modules", views.api_modules, name="api_modules"),
    path("api/refresh", views.api_refresh, name="api_refresh"),
    path("api/timetable", views.api_timetable, name="api_timetable"),
]
