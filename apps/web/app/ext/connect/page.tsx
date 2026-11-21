// /ext/connect: hands a short-lived sign-in token to the Kismet extension (docs/09 § Auth).
import { PageTitle } from "@/components/kit";
import { Connect } from "./Connect";

export const metadata = { title: "Connect the extension" };

export default function Page() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageTitle title="Connect the extension" sub="Kismet for Polymarket shows win chances and estimated returns right on Polymarket pages." />
      <Connect storeUrl={process.env.NEXT_PUBLIC_EXTENSION_STORE_URL || null} />
    </div>
  );
}
