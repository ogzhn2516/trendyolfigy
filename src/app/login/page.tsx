import { redirect } from "next/navigation";

import { loginAction } from "@/app/login/actions";
import { isAdminAuthenticated } from "@/lib/auth";

import styles from "./login.module.css";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  if (await isAdminAuthenticated()) {
    redirect("/admin");
  }

  const params = await searchParams;

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <div className={styles.brand}>
          <span>Figyfun</span>
          <h1>Trendyol ürün kuyruğu</h1>
          <p>Telegram’dan gelen ürün taslaklarını kontrol edip gönder.</p>
        </div>

        <form action={loginAction} className={styles.form}>
          <label>
            Kullanıcı adı
            <input autoComplete="username" name="username" required />
          </label>
          <label>
            Şifre
            <input
              autoComplete="current-password"
              name="password"
              required
              type="password"
            />
          </label>
          {params.error ? (
            <p className={styles.error}>Giriş bilgileri doğrulanamadı.</p>
          ) : null}
          <button type="submit">Admin paneline gir</button>
        </form>
      </section>
    </main>
  );
}
