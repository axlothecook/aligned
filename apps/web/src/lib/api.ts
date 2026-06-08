// The app-wide API client singleton, built from @aligned/core with the web's base URL.
import { createApiClient } from '@aligned/core';

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export const api = createApiClient(baseUrl);
