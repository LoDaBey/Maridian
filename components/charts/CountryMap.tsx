"use client";

import { useEffect, useMemo, useState } from "react";
import type { Feature, Geometry } from "geojson";
import { bucketTotals, EmptyChart, fmt, rampColor, Tip, useWidth, type ChartProps, type TipState } from "./primitives";

/** Map shape names that don't match the English country name of their ISO code. */
const ALIASES: Record<string, string> = {
  "united states of america": "US",
  "w. sahara": "EH",
  "dem. rep. congo": "CD",
  "dominican rep.": "DO",
  "falkland is.": "FK",
  "fr. s. antarctic lands": "TF",
  "central african rep.": "CF",
  congo: "CG",
  "eq. guinea": "GQ",
  eswatini: "SZ",
  "côte d'ivoire": "CI",
  palestine: "PS",
  laos: "LA",
  myanmar: "MM",
  vietnam: "VN",
  "north korea": "KP",
  "south korea": "KR",
  moldova: "MD",
  turkey: "TR",
  "solomon is.": "SB",
  taiwan: "TW",
  brunei: "BN",
  "bosnia and herz.": "BA",
  macedonia: "MK",
  kosovo: "XK",
  "s. sudan": "SS",
  czechia: "CZ",
  russia: "RU",
  iran: "IR",
  syria: "SY",
  bolivia: "BO",
  venezuela: "VE",
  tanzania: "TZ",
  "timor-leste": "TL",
  antarctica: "AQ",
};

interface Shape {
  code: string;
  name: string;
  rings: Array<Array<[number, number]>>;
}

let shapesPromise: Promise<Shape[]> | null = null;

/** Loads and decodes the 110m world outline once, only when a map is on screen. */
function loadShapes(): Promise<Shape[]> {
  shapesPromise ??= Promise.all([import("world-atlas/countries-110m.json"), import("topojson-client")]).then(([atlas, topo]) => {
    const topology = (atlas.default ?? atlas) as unknown as Parameters<typeof topo.feature>[0];
    const countries = (topology as unknown as { objects: { countries: Parameters<typeof topo.feature>[1] } }).objects.countries;
    const collection = topo.feature(topology, countries) as unknown as {
      features: Array<Feature<Geometry, { name: string }>>;
    };
    const display = new Intl.DisplayNames("en", { type: "region" });
    const norm = (value: string) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
    const byName = new Map<string, string>();
    for (let a = 65; a <= 90; a += 1) {
      for (let b = 65; b <= 90; b += 1) {
        const code = String.fromCharCode(a, b);
        const name = display.of(code);
        if (name && name !== code) {
          byName.set(norm(name), code);
        }
      }
    }
    return collection.features.flatMap((feature) => {
      const name = feature.properties.name;
      const code = ALIASES[name.toLowerCase()] ?? byName.get(norm(name));
      if (!code || code === "AQ") {
        return [];
      }
      const geometry = feature.geometry;
      const polygons =
        geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
      const rings = polygons.flatMap((polygon) => polygon.map((ring) => ring.map(([lon, lat]) => [lon, lat] as [number, number])));
      return [{ code, name, rings }];
    });
  });
  return shapesPromise;
}

/** Items per country, shaded on a world map that zooms to where the data is. */
export function CountryMapChart({ result, measure, onDrill, height }: ChartProps) {
  const [shapes, setShapes] = useState<Shape[] | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadShapes().then((loaded) => {
      if (!cancelled) {
        setShapes(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => {
    const map = new Map<string, { value: number; label: string; key: string }>();
    for (const bucket of bucketTotals(result)) {
      if (bucket.key) {
        map.set(bucket.key.toUpperCase(), { value: bucket.value, label: bucket.label, key: bucket.key });
      }
    }
    return map;
  }, [result]);

  if (totals.size === 0) {
    return <EmptyChart message="No countries in these items yet." />;
  }
  if (!shapes || width === 0) {
    return <div ref={ref} className="h-full w-full animate-pulse rounded-md bg-row" style={{ height }} />;
  }

  // Fit the view to countries with data (equirectangular), with some breathing room.
  let minLon = 180;
  let maxLon = -180;
  let minLat = 90;
  let maxLat = -90;
  for (const shape of shapes) {
    if (!totals.has(shape.code)) {
      continue;
    }
    for (const ring of shape.rings) {
      for (const [lon, lat] of ring) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    }
  }
  if (minLon > maxLon) {
    minLon = -170;
    maxLon = 190;
    minLat = -58;
    maxLat = 78;
  }
  const padLon = Math.max(10, (maxLon - minLon) * 0.25);
  const padLat = Math.max(8, (maxLat - minLat) * 0.25);
  minLon -= padLon;
  maxLon += padLon;
  minLat -= padLat;
  maxLat += padLat;
  const mapWidth = width;
  const scale = Math.min(mapWidth / (maxLon - minLon), height / (maxLat - minLat));
  const offsetX = (mapWidth - (maxLon - minLon) * scale) / 2;
  const offsetY = (height - (maxLat - minLat) * scale) / 2;
  const project = (lon: number, lat: number) => [offsetX + (lon - minLon) * scale, offsetY + (maxLat - lat) * scale];
  const max = Math.max(...[...totals.values()].map((item) => item.value), 1);

  return (
    <div ref={ref} className="relative w-full overflow-hidden" style={{ height }} onMouseLeave={() => setTip(null)}>
      <svg width={mapWidth} height={height} role="img" aria-label="Items per country">
        {shapes.map((shape) => {
          const data = totals.get(shape.code);
          const d = shape.rings
            .map((ring) => ring.map(([lon, lat], index) => `${index === 0 ? "M" : "L"}${project(lon, lat).join(",")}`).join("") + "Z")
            .join("");
          return (
            <path
              key={shape.code + shape.name}
              d={d}
              fill={data ? rampColor(0.15 + (data.value / max) * 0.85) : "var(--chart-grid)"}
              stroke="var(--surface)"
              strokeWidth={0.6}
              className={data && onDrill ? "cursor-pointer" : undefined}
              onMouseMove={(event) => {
                const box = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
                setTip({
                  x: event.clientX - box.left,
                  y: event.clientY - box.top,
                  title: data?.label ?? shape.name,
                  lines: [data ? fmt(data.value, measure) : "No items"],
                });
              }}
              onClick={() => data && onDrill?.(data.key)}
            />
          );
        })}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}
