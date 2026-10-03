"use client";
import { useState } from "react";
import { GraduationCap, ArrowRight } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent } from "./ui/card";
export function LoginForm() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="p-9">
          <div className="w-12 h-12 bg-primary text-white rounded-xl grid place-items-center mb-7">
            <GraduationCap />
          </div>
          <p className="text-xs font-semibold tracking-widest text-slate-500 mb-2">
            COURSE SALES
          </p>
          <h1 className="text-2xl font-semibold mb-2">Вход в систему</h1>
          <p className="text-sm text-slate-500 mb-8">
            Управление клиентами, оплатами и обучением.
          </p>
          <form
            className="space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setError("");
              const form = new FormData(e.currentTarget);
              try {
                const response = await fetch("/api/auth/login", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    email: form.get("email"),
                    password: form.get("password"),
                  }),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);
                window.location.replace(
                  new URL("/admin", window.location.origin).href,
                );
              } catch (err) {
                setError(err instanceof Error ? err.message : "Ошибка входа");
              } finally {
                setPending(false);
              }
            }}
          >
            <label className="block text-sm">
              Email
              <Input
                className="mt-2"
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label className="block text-sm">
              Пароль
              <Input
                className="mt-2"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <Button className="w-full" disabled={pending}>
              {pending ? "Входим…" : "Войти"}
              <ArrowRight size={16} />
            </Button>
          </form>
          <p className="text-xs text-slate-400 mt-6">
            Доступ предоставляется администратором.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
