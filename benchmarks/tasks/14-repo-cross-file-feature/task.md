Add support for a `FIXED_AMOUNT` discount type to `src/discount.ts`, following the existing pattern for `PERCENTAGE` (a discriminated union on `type`).

A `FIXED_AMOUNT` discount subtracts a flat `value` from the subtotal, and the result must never go below 0. Update `applyDiscount` to handle the new type. `src/cart.ts` should not need any changes — it already passes any `Discount` through to `applyDiscount`.
