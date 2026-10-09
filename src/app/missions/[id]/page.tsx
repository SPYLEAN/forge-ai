import { Suspense } from "react";
import { MissionDetail } from "./MissionDetail";

export default function MissionPage() {
  // The mission id is only known at request time, so it streams in under Suspense.
  return (
    <Suspense>
      <MissionDetail />
    </Suspense>
  );
}
