import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { findCourseById } from "./courseStore";
import { signStudentAccessToken } from "./studentAuthJwt";
import { getStudentAuthUsers, writeStudentAuthUsers } from "./studentAuthStore";
import { normalizeAdmission, normalizeEmail, readStudents } from "./studentStore.server";

export type StudentRegistrationInput = {
	admissionNumber?: string;
	email?: string;
	password?: string;
	institutionId?: string;
	courseId?: string;
};

type RegistrationErrorCode = "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "SERVER_ERROR";

type RegistrationError = {
	ok: false;
	status: number;
	code: RegistrationErrorCode;
	error: string;
};

type RegistrationSuccess = {
	ok: true;
	status: number;
	payload: {
		success: true;
		user: {
			id: string;
			name: string;
			email: string;
			institutionId?: string;
			course: {
				id: string;
				code: string;
				name: string;
			};
		};
		account: {
			id: string;
			studentId: string;
			admissionNumber: string;
			email: string;
			createdAt: string;
		};
		student: {
			id: string;
			admissionNumber: string;
			name: string;
			email: string;
			institutionId?: string;
		};
		accessToken: string;
	};
};

export type StudentRegistrationResult = RegistrationSuccess | RegistrationError;

export async function registerStudentAccount(
	input: StudentRegistrationInput,
): Promise<StudentRegistrationResult> {
	const admissionNumber = normalizeAdmission(input.admissionNumber ?? "");
	const email = normalizeEmail(input.email ?? "");
	const password = input.password ?? "";

	if (!admissionNumber || !email || !password) {
		return {
			ok: false,
			status: 400,
			code: "BAD_REQUEST",
			error: "admissionNumber, email, and password are required.",
		};
	}

	if (password.length < 6) {
		return {
			ok: false,
			status: 400,
			code: "BAD_REQUEST",
			error: "Password must be at least 6 characters.",
		};
	}

	const studentRow = input.institutionId
		? await prisma.student.findUnique({
				where: { institutionId_admissionNumber: { institutionId: input.institutionId, admissionNumber } },
				include: { auth: true },
			})
		: await prisma.student.findFirst({
				where: { admissionNumber },
				include: { auth: true },
			});
	const student = studentRow
		? {
			id: studentRow.id,
			name: studentRow.name,
			admissionNumber: studentRow.admissionNumber,
			courseId: studentRow.courseId ?? "",
			institutionId: studentRow.institutionId,
			email: studentRow.auth?.email ?? undefined,
		}
		: null;

	if (!student) {
		return {
			ok: false,
			status: 404,
			code: "NOT_FOUND",
			error: "Admission number not found.",
		};
	}

	const studentCourseId = student.courseId?.trim() ?? "";
	if (!studentCourseId) {
		return {
			ok: false,
			status: 400,
			code: "BAD_REQUEST",
			error: "Student has no course mapping. Contact your department admin.",
		};
	}

	const course = await findCourseById(studentCourseId);
	if (!course) {
		return {
			ok: false,
			status: 400,
			code: "BAD_REQUEST",
			error: `No course exists for this student mapping (${studentCourseId}).`,
		};
	}

	const users = await getStudentAuthUsers();

	const duplicateAdmission = users.some(
		(user) => normalizeAdmission(user.admissionNumber) === admissionNumber,
	);

	if (duplicateAdmission) {
		return {
			ok: false,
			status: 409,
			code: "CONFLICT",
			error: "Account already exists for this admission number.",
		};
	}

	const duplicateEmail = users.some((user) => normalizeEmail(user.email) === email);
	if (duplicateEmail) {
		return {
			ok: false,
			status: 409,
			code: "CONFLICT",
			error: "Email is already in use.",
		};
	}

	const passwordHash = await bcrypt.hash(password, 12);

	// Create new StudentAuth record using Prisma
	const createdUser = await prisma.studentAuth.create({
		data: {
			id: randomUUID(),
			studentId: student.id,
			email,
			passwordHash,
			createdAt: new Date(),
		},
		include: { student: true },
	});

	const token = signStudentAccessToken({
		userId: createdUser.id,
		studentId: createdUser.studentId,
		courseId: course.id,
		admissionNumber: student.admissionNumber,
		email: createdUser.email,
	});

	return {
		ok: true,
		status: 201,
		payload: {
			success: true,
			   user: {
				   id: createdUser.id,
				   name: student.name,
				   email: createdUser.email,
				   institutionId: student.institutionId,
				   course: {
					   id: course.id,
					   code: course.code,
					   name: course.name,
				   },
			   },
			account: {
				id: createdUser.id,
				studentId: createdUser.studentId,
				admissionNumber: student.admissionNumber,
				email: createdUser.email,
				createdAt: createdUser.createdAt.toISOString(),
			},
			   student: {
				   id: student.id,
				   admissionNumber: student.admissionNumber,
				   institutionId: student.institutionId,
				   name: student.name,
				   email: student.email ?? createdUser.email,
			   },
			accessToken: token,
		},
	};
}
