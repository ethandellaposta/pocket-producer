"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { FrequencyBand } from "@/lib/audio-analyzer";

interface FrequencyChartProps {
  bands: FrequencyBand[];
}

const ratingColors: Record<FrequencyBand["rating"], string> = {
  deficient: "#ef4444",
  low: "#f59e0b",
  balanced: "#10b981",
  elevated: "#f59e0b",
  excessive: "#ef4444",
};

export function FrequencyChart({ bands }: FrequencyChartProps) {
  const data = bands.map((b) => ({
    name: b.name,
    energy: b.energy,
    range: b.range,
    rating: b.rating,
  }));

  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={30}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                  <p className="text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">{d.range}</p>
                  <p className="text-sm font-semibold mt-1">
                    Energy: {d.energy}%
                  </p>
                  <p className="text-xs capitalize" style={{ color: ratingColors[d.rating as FrequencyBand["rating"]] }}>
                    {d.rating}
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="energy" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell
                key={index}
                fill={ratingColors[entry.rating]}
                fillOpacity={0.8}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
