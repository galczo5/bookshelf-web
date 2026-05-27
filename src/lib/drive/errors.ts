export class DriveAuthError extends Error {
  code = "DRIVE_AUTH_ERROR" as const;
  constructor(message = "Drive authentication failed") {
    super(message);
    this.name = "DriveAuthError";
  }
}
