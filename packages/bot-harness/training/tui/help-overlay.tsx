import React from 'react';
import { Box, Text } from 'ink';

/**
 * Help overlay displaying keyboard shortcuts (D-11).
 *
 * Rendered on top of the dashboard content when the user presses 'h'.
 */
export function HelpOverlay(): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="cyan">Keyboard Shortcuts</Text>
      <Text>{'\u2500'.repeat(20)}</Text>
      <Text>
        <Text bold>Space</Text>{'   '}Pause / Resume training
      </Text>
      <Text>
        <Text bold>q</Text>{'       '}Graceful stop (finish current batch, save, exit)
      </Text>
      <Text>
        <Text bold>Tab</Text>{'     '}Cycle detail views
      </Text>
      <Text>
        <Text bold>h</Text>{'       '}Toggle this help overlay
      </Text>
    </Box>
  );
}
