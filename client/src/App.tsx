// Design: «Глухая тьма» — React остаётся невидимой рамкой вокруг одинокой мобильной игровой сцены.
import { lazy, Suspense } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";

const GameCanvas = lazy(() => import("@/components/GameCanvas"));

function GameRoute() {
  return (
    <Suspense fallback={<main className="game-shell" aria-label="Загрузка игры" />}>
      <GameCanvas />
    </Suspense>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={GameRoute} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Router />
    </ErrorBoundary>
  );
}
