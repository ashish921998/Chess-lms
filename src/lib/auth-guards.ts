import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";

export type ActorStudent = {
  id: string;
  userId: string;
  tutorId: string;
  displayName: string;
};

export type ActorTutor = {
  id: string;
  userId: string;
};

/**
 * Marker thrown by guards when the session is missing or the user lacks the
 * required profile. Layouts catch this and redirect to /login. We use a real
 * response (redirect) for pages; API routes call getSession() directly and
 * return JSON errors.
 */
export class Unauthorized extends Error {}

async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session;
}

/** Returns the Tutor profile, or redirects to /login if unauthenticated. */
export async function requireTutor(): Promise<ActorTutor> {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (session.user.role !== "TUTOR") redirect("/dashboard");
  const tutor = await db.tutor.findUnique({ where: { userId: session.user.id } });
  if (!tutor) redirect("/login");
  return { id: tutor.id, userId: tutor.userId };
}

/** Returns the Student profile, or redirects to /login if unauthenticated. */
export async function requireStudent(): Promise<ActorStudent> {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (session.user.role !== "STUDENT") redirect("/roster");
  const student = await db.student.findUnique({ where: { userId: session.user.id } });
  if (!student) redirect("/login");
  return {
    id: student.id,
    userId: student.userId,
    tutorId: student.tutorId,
    displayName: student.displayName,
  };
}

/**
 * Resolves the session to a student profile WITHOUT redirecting (for API
 * routes). Returns null if unauthenticated or not a student.
 */
export async function getStudentActor(): Promise<ActorStudent | null> {
  const session = await getSessionUser();
  if (!session || session.user.role !== "STUDENT") return null;
  const student = await db.student.findUnique({ where: { userId: session.user.id } });
  if (!student) return null;
  return {
    id: student.id,
    userId: student.userId,
    tutorId: student.tutorId,
    displayName: student.displayName,
  };
}

/**
 * Resolves the session to a tutor profile WITHOUT redirecting (for API routes).
 */
export async function getTutorActor(): Promise<ActorTutor | null> {
  const session = await getSessionUser();
  if (!session || session.user.role !== "TUTOR") return null;
  const tutor = await db.tutor.findUnique({ where: { userId: session.user.id } });
  if (!tutor) return null;
  return { id: tutor.id, userId: tutor.userId };
}

/**
 * Asserts a student record belongs to the acting tutor. Returns the student or
 * calls notFound() (404) — never reveals existence of another tutor's student.
 */
export async function requireTutorOwnsStudent(studentId: string, tutor: ActorTutor) {
  const student = await db.student.findUnique({ where: { id: studentId } });
  if (!student || student.tutorId !== tutor.id) notFound();
  return student;
}
