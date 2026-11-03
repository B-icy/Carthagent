# Carthagent 1.1.0-beta.5

## Startup and update feedback

- Animated, transient status lines explain runtime preparation, service connection,
  and update progress. Cancellation clears the line and stops startup before the
  console opens.
- Native startup shows its loading animation after a short delay, avoiding a
  flash on fast starts and a long artificial wait.
- Redirected output stays clean. `CTG_REDUCED_MOTION=1` makes launcher and Voyages
  loading feedback static; native animations follow the console's setting.

## Projects and Voyages

- Projects adds clearer folder hierarchy, session states, empty-state guidance,
  and focused keyboard navigation. Folder headings are included in scrolling
  and drag positioning.
- Voyages shows readable quest states, completion counts, indented assignments,
  and account/loading feedback. Long labels fit the sidebar, and selection and
  scrolling survive navigation switches.
- Update, crash, permission, onboarding, and resume messages use Carthagent
  branding. Crash reports open the Carthagent issue tracker.

## Validation

The Linux candidate was exercised through the real launcher and an authenticated
production Cloud account. Voyages loaded the profile, wallet, and three daily
quests; sidebar actions opened both assignments and profile details. Terminal
layouts were checked at 110×36, 80×24, and 60×20. Package quality passed 1,137
tests with five platform-specific skips, and all 35 runtime check tasks passed.

These checks establish startup, navigation, account loading, and display behavior.
They do not establish completion of the earlier expense-reporting coding task.
