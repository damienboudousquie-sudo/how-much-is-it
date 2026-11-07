import type { ApiErrorBody, CalculateRequest, CalculateResponse, DiscoverRequest, DiscoverResponse, HealthResponse, LookupRequest, LookupResponse, SearchResponse } from "@osu-pp/shared";
import { copyFor, currentLang } from "./i18n";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorBody["error"]["code"] | "network",
  ) {
    super(message);
    this.name = "ApiError";
  }
}


async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", "x-lang": currentLang(), ...init?.headers },
    });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new ApiError(copyFor(currentLang()).network, "network");
  }
  if (!response.ok) {
    let message = copyFor(currentLang()).searchFailed;
    let code: ApiError["code"] = "unavailable";
    try {
      const body = (await response.json()) as ApiErrorBody;
      message = body.error.message;
      code = body.error.code;
    } catch {
      message = response.statusText || message;
    }
    throw new ApiError(message, code);
  }
  return response.json() as Promise<T>;
}

export function fetchHealth(): Promise<HealthResponse> {
  return request("/api/health");
}

export function fetchSearch(query: string, signal: AbortSignal): Promise<SearchResponse> {
  return request(`/api/search?q=${encodeURIComponent(query)}`, { signal });
}

export function fetchLookup(body: LookupRequest): Promise<LookupResponse> {
  return request("/api/lookup", { method: "POST", body: JSON.stringify(body) });
}

export function fetchDiscover(body: DiscoverRequest, signal: AbortSignal): Promise<DiscoverResponse> {
  return request("/api/discover", { method: "POST", body: JSON.stringify(body), signal });
}

export function fetchCalculate(body: CalculateRequest): Promise<CalculateResponse> {
  return request("/api/calculate", { method: "POST", body: JSON.stringify(body) });
}
