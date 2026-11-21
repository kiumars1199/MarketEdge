import { Suspense } from "react";
import { MyList } from "@/components/watch/MyList";

export const metadata = { title: "My list", robots: { index: false } };

export default function Page() {
  return (
    <Suspense>
      <MyList />
    </Suspense>
  );
}
