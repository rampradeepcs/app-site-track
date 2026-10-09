"use client";

/**
 * Adding people from Team & Roles. The screen itself is shared with a
 * project's Team tab — see AddPeople.
 */

import { AddPeople } from "@/components/AddPeople";

export default function AddPeoplePage() {
  return <AddPeople backTo="/admin/team" />;
}
