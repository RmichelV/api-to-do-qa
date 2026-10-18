// Uniform application errors: { status, code, message } (design §7).
export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.isAppError = true;
  }
}
