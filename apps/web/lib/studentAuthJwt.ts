import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";

export type StudentJwtPayload = {
  userId: string;
  studentId: string;
  courseId?: string;
  admissionNumber: string;
  email: string;
  jti?: string;
};

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured.");
  }
  return secret;
};

export const signStudentAccessToken = (payload: StudentJwtPayload) => {
  const jti = payload.jti ?? randomUUID();
  return jwt.sign({ ...payload, jti }, getJwtSecret(), { expiresIn: "7d" });
};

export const verifyStudentAccessToken = (token: string): StudentJwtPayload & { jti: string } => {
  const payload = jwt.verify(token, getJwtSecret()) as StudentJwtPayload & { jti: string };
  return payload;
};
