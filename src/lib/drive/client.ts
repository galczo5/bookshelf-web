import "server-only";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import { auth } from "@/auth";
import { DriveAuthError } from "./errors";

export async function getDriveClient(): Promise<drive_v3.Drive> {
  const session = await auth();
  if (
    !session?.user ||
    !session.access_token ||
    session.error === "RefreshAccessTokenError"
  ) {
    throw new DriveAuthError();
  }
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: session.access_token });
  return google.drive({ version: "v3", auth: oauth2Client });
}
