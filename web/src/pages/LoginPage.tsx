import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import { api, ApiError } from "../api/client";
import { ErrorNote } from "../components/ui";

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
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-stone-200 bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold text-emerald-900">Fasola Finance</h1>
          <p className="text-sm text-stone-500">Dashboard admin Dapoer Mami Fasola</p>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            className="w-full rounded border border-stone-300 px-3 py-2 focus:border-emerald-600 focus:outline-none"
          />
        </label>

        {errorMessage ? <ErrorNote message={errorMessage} /> : null}

        <button
          type="submit"
          disabled={login.isPending || !password}
          className="w-full rounded bg-emerald-800 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {login.isPending ? "Masuk..." : "Masuk"}
        </button>
      </form>
    </div>
  );
}
