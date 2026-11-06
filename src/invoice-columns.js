// The official invoice head row is the only source for both the printed document and the
// pricing editor, so the two can never drift apart column by column.
export const INVOICE_COLUMNS = ['ردیف', 'شناسه کالا / خدمت', 'شرح کالا یا خدمات', 'مقدار', 'واحد', 'مبلغ واحد', 'مبلغ کل', 'تخفیف', 'پس از تخفیف', 'مالیات ٪', 'مالیات و عوارض', 'جمع با مالیات و عوارض'];

// Discount and tax belong to the document, not to an editable row, so the editor mirrors only the first seven columns.
export const EDITOR_INVOICE_COLUMNS = INVOICE_COLUMNS.slice(0, 7);
