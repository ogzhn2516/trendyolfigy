"use server";

import { redirect } from "next/navigation";

import { createAdminSession, verifyAdminCredentials } from "@/lib/auth";

export async function loginAction(formData: FormData) {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  let isVerified = false;

  try {
    isVerified = verifyAdminCredentials(username, password);
  } catch {
    redirect("/login?config=1");
  }

  if (!isVerified) {
    redirect("/login?error=1");
  }

  await createAdminSession();
  redirect("/admin");
}
