export class PenumbraError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "PenumbraError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
