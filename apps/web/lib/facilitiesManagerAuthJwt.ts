import jwt from "jsonwebtoken";

export type FacilitiesManagerJwtPayload = {
  id: string;
  email: string;
  institutionId: string;
};

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured.");
  return secret;
};

export const signFacilitiesManagerToken = (payload: FacilitiesManagerJwtPayload): string => {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
};

export const verifyFacilitiesManagerJwt = (token: string): FacilitiesManagerJwtPayload => {
  return jwt.verify(token, getJwtSecret()) as FacilitiesManagerJwtPayload;
};
