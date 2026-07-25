import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";

export type LecturerJwtPayload = {
  lecturerId: string;
  email: string;
  phoneNumber: string;
  jti?: string;
};

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured.");
  }
  return secret;
};

export const signLecturerAccessToken = (payload: LecturerJwtPayload) => {
  const jti = payload.jti ?? randomUUID();
  return jwt.sign({ ...payload, jti }, getJwtSecret(), { expiresIn: "7d" });
};

export const verifyLecturerAccessToken = (token: string): LecturerJwtPayload & { jti: string } => {
  return jwt.verify(token, getJwtSecret()) as LecturerJwtPayload & { jti: string };
};
