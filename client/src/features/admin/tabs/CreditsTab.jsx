import RatesCard from "../credits/RatesCard";
import PacksCard from "../credits/PacksCard";
import StripeCard from "../credits/StripeCard";
import LedgerCard from "../credits/LedgerCard";

/**
 * Credits, as an admin runs them: what a minute costs, what people can buy, how
 * payments are set up, and every credit that has moved. Plans' monthly credits
 * are set on the Plans tab, and one person's balance on their own page.
 */
export default function CreditsTab() {
  return (
    <div className="space-y-6">
      <RatesCard />
      <PacksCard />
      <StripeCard />
      <LedgerCard />
    </div>
  );
}
