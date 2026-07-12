import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import { api, ApiError } from "../api/client";
import { Rise } from "../components/motion/primitives";
import { Button } from "../components/ui/Button";
import { ErrorNote } from "../components/ui/Feedback";
import { Field, Input } from "../components/ui/Field";

export function LoginPage() {
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const login = useMutation({
    mutationFn: (candidate: string) =>
      api<{ authenticated: boolean }>("/api/auth/login", {
        method: "POST",
        body: { password: candidate }
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth"] });
      await navigate("/");
    }
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (password) {
      login.mutate(password);
    }
  };

  const errorMessage =
    login.error instanceof ApiError
      ? login.error.status === 429
        ? "Terlalu banyak percobaan. Tunggu sebentar."
        : login.error.message
      : login.error
        ? "Terjadi kesalahan. Coba lagi."
        : null;

  return (
    <div className="pattern-batik flex min-h-dvh items-center justify-center bg-pandan-950 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm">
        {/* A short, decisive shake when the password is wrong. */}
        <motion.div
          animate={login.isError ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }}
          transition={{ duration: 0.35 }}
          className="space-y-5 rounded-card border border-pandan-800 bg-cream-50 p-6 shadow-lift sm:p-7"
        >
          <Rise>
            <p className="text-xs font-semibold tracking-[0.2em] text-pandan-600 uppercase">
              Dapoer Mami Fasola
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold text-pandan-900">
              Fasola Finance
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              Dashboard admin untuk pesanan, menu, dan keuangan.
            </p>
          </Rise>

          <Rise delay={0.07}>
            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
                autoComplete="current-password"
              />
            </Field>
          </Rise>

          {errorMessage ? <ErrorNote message={errorMessage} /> : null}

          <Rise delay={0.14}>
            <Button
              type="submit"
              loading={login.isPending}
              disabled={!password}
              className="w-full"
            >
              Masuk
            </Button>
          </Rise>
        </motion.div>
      </form>
    </div>
  );
}
