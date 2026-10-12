import { validateInstructorDetails, validateReviewUrl } from '../instructorDetails';

const ok = { fullName: 'Grant Robery', adiNumber: '1234567' };

describe('validateInstructorDetails', () => {
  it('accepts a name and an ADI/PDI number', () => {
    expect(validateInstructorDetails(ok)).toBeNull();
  });

  it('needs a name and an ADI/PDI number, ignoring spaces', () => {
    expect(validateInstructorDetails({ ...ok, fullName: '   ' })).toMatch(/name/i);
    expect(validateInstructorDetails({ ...ok, adiNumber: '' })).toMatch(/ADI/);
  });
});

describe('validateReviewUrl', () => {
  it('accepts a blank link or a web address in either case', () => {
    expect(validateReviewUrl('')).toBeNull();
    expect(validateReviewUrl('  ')).toBeNull();
    expect(validateReviewUrl('https://g.page/r/abc/review')).toBeNull();
    expect(validateReviewUrl('HTTP://example.com')).toBeNull();
  });

  it('rejects anything that is not a web address', () => {
    expect(validateReviewUrl('g.page/r/abc')).toMatch(/https/);
    expect(validateReviewUrl('ftp://example.com')).toMatch(/https/);
  });
});
