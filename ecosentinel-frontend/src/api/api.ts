// ============================================================
// api/api.ts
// All backend API calls in one file.
// Base URL is read from VITE_API_BASE_URL env variable.
// ============================================================

import axios, { type AxiosError } from 'axios';
import type {
  DetectRequest,
  DetectBatchResponse,
  AnomalyExplanationResponse,
  HealthResponse,
  ModelInfoResponse,
  ModelReloadResponse,
} from '@/types';

// ?? Axios instance ????????????????????????????????????????????

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000';

export const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  },
});

// Response interceptor — normalise errors into a consistent shape
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const detail =
      // FastAPI error shape: { detail: "..." }
      (error.response?.data as { detail?: string })?.detail ??
      error.message ??
      'Unknown error';
    return Promise.reject(new Error(detail));
  },
);

// ?? Endpoints ?????????????????????????????????????????????????

/**
 * POST /detect
 * Runs the full three-layer anomaly detection pipeline.
 */
export async function postDetect(payload: DetectRequest): Promise<DetectBatchResponse> {
  const { data } = await apiClient.post<DetectBatchResponse>('/detect', payload);
  return data;
}

/**
 * GET /anomalies/{id}/explanation
 * Fetches the LLM-generated explanation for a flagged anomaly.
 * May need to be polled until explanation_status !== 'pending'.
 */
export async function getExplanation(anomalyId: number): Promise<AnomalyExplanationResponse> {
  const { data } = await apiClient.get<AnomalyExplanationResponse>(
    `/anomalies/${anomalyId}/explanation`,
  );
  return data;
}

/**
 * GET /health
 * Service liveness check — returns component statuses.
 */
export async function getHealth(): Promise<HealthResponse> {
  const { data } = await apiClient.get<HealthResponse>('/health');
  return data;
}

/**
 * GET /model/info
 * Returns feature schema, detection thresholds, artifact paths.
 */
export async function getModelInfo(): Promise<ModelInfoResponse> {
  const { data } = await apiClient.get<ModelInfoResponse>('/model/info');
  return data;
}

/**
 * POST /model/reload
 * Hot-reloads model artifacts from disk without restarting the service.
 */
export async function postModelReload(): Promise<ModelReloadResponse> {
  const { data } = await apiClient.post<ModelReloadResponse>('/model/reload');
  return data;
}

/** Returns the configured API base URL for display in the UI. */
export function getApiBaseUrl(): string {
  return BASE_URL;
}
