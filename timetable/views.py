import json

import requests
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from . import services


def index(request):
    return render(request, "timetable/index.html")


@require_GET
def api_modules(request):
    query = request.GET.get("q", "")
    try:
        results = services.search_modules(query)
    except requests.RequestException:
        return JsonResponse({"error": "Could not fetch module list from CELCAT."}, status=502)
    return JsonResponse({"count": len(results), "modules": results})


@csrf_exempt
@require_POST
def api_refresh(request):
    try:
        modules = services.get_modules(force_refresh=True)
    except requests.RequestException:
        return JsonResponse({"error": "Could not refresh module list."}, status=502)
    return JsonResponse({"count": len(modules)})


@csrf_exempt
@require_POST
def api_timetable(request):
    try:
        body = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)

    module_ids = body.get("moduleIds")
    if not module_ids or not isinstance(module_ids, list):
        return JsonResponse({"error": "moduleIds must be a non-empty array."}, status=400)

    result = services.build_timetable(module_ids)
    return JsonResponse(result)
