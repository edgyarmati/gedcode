import { ExternalLinkIcon } from "lucide-react";

import { Button } from "../ui/button";

export function TaskPrLink({ prUrl }: { prUrl: string | null }) {
  if (!prUrl) {
    return null;
  }
  return (
    <Button
      render={<a href={prUrl} target="_blank" rel="noreferrer" />}
      size="xs"
      variant="outline"
    >
      <ExternalLinkIcon className="size-3.5" />
      View PR
    </Button>
  );
}
