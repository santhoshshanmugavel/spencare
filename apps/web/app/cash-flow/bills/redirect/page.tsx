import { redirect } from "next/navigation";

/** /cash-flow/bills now redirects to /cash-flow/upcoming. */
export default function BillsRedirect() {
  redirect("/cash-flow/upcoming");
}
