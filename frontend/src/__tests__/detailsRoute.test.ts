import { myDetailsRoute, MY_DETAILS_EDITABLE_ROUTE, MY_DETAILS_VIEW_ROUTE } from '../detailsRoute';

describe('myDetailsRoute', () => {
  it.each(['starter', 'growth', 'pro'])('sends %s instructors to the editable screen', (tier) => {
    expect(myDetailsRoute(tier)).toBe(MY_DETAILS_EDITABLE_ROUTE);
  });

  it('sends Franchise instructors to the view-only screen', () => {
    expect(myDetailsRoute('franchise')).toBe(MY_DETAILS_VIEW_ROUTE);
  });

  it('defaults to the editable screen when the tier is not known yet', () => {
    expect(myDetailsRoute(undefined)).toBe(MY_DETAILS_EDITABLE_ROUTE);
    expect(myDetailsRoute(null)).toBe(MY_DETAILS_EDITABLE_ROUTE);
  });
});
