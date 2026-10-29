# Security

## Reporting a problem

If you think you have found a security problem in DualControl (the app, the website or the server), please tell us privately before sharing it anywhere else.

- **Email:** dualcontrol@drivingschoolsolutions.co.uk, with "Security" in the subject.
- Say what you found, how to see it, and what you think the risk is. Please don't include real pupil or instructor data.
- We will reply as soon as we can, usually within a few days, and tell you when it is fixed.

Please don't test against other people's accounts or data, and don't run anything that could slow the service down for other users.

## Keeping secrets out of this repository

Keys, passwords, the Android signing keystore and service-account files must never be committed. `.gitignore` blocks the common file types, and every pull request is scanned (gitleaks) for secrets. If a key is ever committed by mistake, replace the key straight away: deleting the file does not remove it from history.
