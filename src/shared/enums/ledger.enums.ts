export enum LedgerAccountType {
  ASSET = "ASSET",          // e.g., bank accounts, platform settlement cash, or reserves
  LIABILITY = "LIABILITY",  // e.g., user fiat wallets, payout obligations
  REVENUE = "REVENUE",      // e.g., fee collection accounts
  EXPENSE = "EXPENSE",      // e.g., network gas fees, operational costs
}

export enum PostingDirection {
  DEBIT = "DEBIT",   // Positive change (+ amount)
  CREDIT = "CREDIT", // Negative change (- amount)
}
