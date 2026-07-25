import { z } from "zod";

const roomStatusSchema = z.enum(["free", "reserved", "occupied", "unavailable"]);
const roomTypeSchema = z.string().trim().min(1).max(60);

export const createRoomSchema = z.object({
  institutionId: z.string().trim().min(1).max(80),
  buildingCode: z.string().trim().min(1).max(24),
  roomCode: z.string().trim().min(1).max(24),
  name: z.string().trim().min(1).max(120),
  capacity: z.number().int().positive().max(5000),
  type: roomTypeSchema,
  floor: z.number().int().min(-5).max(200).default(0),
  status: roomStatusSchema.default("free"),
  isActive: z.boolean().default(true),
});

export const patchRoomSchema = createRoomSchema.partial().refine((payload) => Object.keys(payload).length > 0, {
  message: "At least one field is required.",
});

export const roomsQuerySchema = z.object({
  institutionId: z.string().trim().optional(),
  buildingCode: z.string().trim().optional(),
  date: z.string().trim().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  capacity: z.coerce.number().int().positive().optional(),
  type: z.string().trim().optional(),
  status: roomStatusSchema.optional(),
});

export const holdSchema = z
  .object({
    roomId: z.string().trim().min(1),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    lecturerId: z.string().trim().min(1),
  })
  .superRefine((payload, ctx) => {
    const start = new Date(payload.startAt);
    const end = new Date(payload.endAt);
    if (start >= end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endAt must be after startAt.",
        path: ["endAt"],
      });
    }
  });

export const confirmSchema = z.object({
  holdId: z.string().trim().min(1),
  unitCode: z.string().trim().min(1).max(30),
  idempotencyKey: z.string().trim().min(8).max(120),
});
