---
paths:
  - "frontend/**"
---

# Frontend API client rules

- API paths must NOT include the `/api` prefix — `client.js` supplies it via
  `baseURL` (`http://localhost:8000/api` locally, `/api` in Docker).
  - ✅ `apiClient.get('/v1/themes/rankings')`
  - ❌ `apiClient.get('/api/v1/themes/rankings')` → becomes `/api/api/v1/...` (404) in Docker
- `BASE_PATH` constants likewise start with `/v1/...`, never `/api/v1/...`.
- New endpoints: add the call in `frontend/src/api/`, consume through React
  Query; do not fetch directly inside components.
