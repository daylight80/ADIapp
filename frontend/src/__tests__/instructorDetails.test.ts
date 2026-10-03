import { validateInstructorDetails } from '../instructorDetails';

const ok = { fullName: 'Grant Robery', adiNumber: '1234567', googleReviewUrl: '' };

describe('validateInstructorDetails', () => {
  it('accepts complete details, with or without a review link', () => {
    expect(validateInstructorDetails(ok)).toBeNull();
    expect(validateInstructorDetails({ ...ok, googleReviewUrl: 'https://g.page/r/abc/review' })).toBeNull();
    expect(validateInstructorDetails({ ...ok, googleReviewUrl: 'HTTP://example.com' })).toBeNull();
  });

  it('needs a name and an ADI/PDI number, ignoring spaces', () => {
    expect(validateInstructorDetails({ ...ok, fullName: '   ' })).toMatch(/name/i);
    expect(validateInstructorDetails({ ...ok, adiNumber: '' })).toMatch(/ADI/);
  });

  it('rejects a review link that is not a web address', () => {
    expect(validateInstructorDetails({ ...ok, googleReviewUrl: 'g.page/r/abc' })).toMatch(/https/);
    expect(validateInstructorDetails({ ...ok, googleReviewUrl: '  ' })).toBeNull();
  });
});
