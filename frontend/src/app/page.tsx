"use client";

import dynamic from "next/dynamic";

const MapaClimatico = dynamic(() => import("@/components/MapaClimatico"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-slate-500">
      Carregando mapa...
    </div>
  ),
});

export default function Home() {
  return (
    <main className="h-dvh w-full">
      <MapaClimatico />
    </main>
  );
}
