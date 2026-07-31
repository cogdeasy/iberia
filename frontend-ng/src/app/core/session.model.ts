export interface SessionUser {
  email: string;
  full_name: string;
  role: string;
  iberia_plus_number?: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
