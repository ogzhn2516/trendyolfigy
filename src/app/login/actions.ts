"use server";

import { redirect } from "next/navigation";

import { createAdminSession, verifyAdminCredentials } from "@/lib/auth";

export async function loginAction(formData: FormData) {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!verifyAdminCredentials(username, password)) {
    redirect("/login?error=1");
  }

  await createAdminSession();
  redirect("/admin");
}
