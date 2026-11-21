// Marc's QA list #19/#53 (Nov 20): the save dialog starts with a name built from the filters ("My view" with none),
// and a "Saved views" list on Best bets and All markets applies, renames and deletes them.
import { expect, test } from "@playwright/test";

test("#19/#53 saved views: suggested name, then apply, rename and delete from /bets and /markets", async ({ page }) => {
  test.setTimeout(120_000);
  // nothing on: "My view"
  await page.goto("/bets");
  await expect(async () => {
    await page.getByRole("button", { name: "+ Save this view" }).click();
    await expect(page.getByRole("dialog", { name: "Save this view" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const save = page.getByRole("dialog", { name: "Save this view" });
  await expect(save.getByRole("textbox", { name: "Name" })).toHaveValue("My view");
  await save.getByRole("button", { name: "Cancel" }).click();

  // filters on: the name says which, and one tap saves it
  await page.goto("/markets?t=sports.nfl&wp=0.7");
  await page.locator("[data-row]").first().waitFor();
  await page.getByRole("button", { name: "+ Save this view" }).click();
  await expect(save.getByRole("textbox", { name: "Name" })).toHaveValue(/NFL.*70%\+ to win/);
  const suggested = await save.getByRole("textbox", { name: "Name" }).inputValue();
  await save.getByRole("button", { name: "Save", exact: true }).click();
  await expect(save).toBeHidden();

  // /bets: the list applies it
  await page.goto("/bets");
  const list = page.getByRole("dialog", { name: "Saved views" });
  await expect(async () => {
    await page.getByTestId("saved-views").click();
    await expect(list).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await list.getByRole("button", { name: `Apply ${suggested}` }).click();
  await expect(list).toBeHidden();
  await expect(page).toHaveURL(/\/bets\?.*t=sports\.nfl/);

  // /markets: rename, then delete (asks once more)
  await page.goto("/markets");
  await page.getByTestId("saved-views").click();
  await list.getByRole("button", { name: `Rename ${suggested}` }).click();
  await list.getByRole("textbox", { name: "New name" }).fill("Sunday NFL");
  await list.getByRole("button", { name: "Save", exact: true }).click();
  await expect(list.getByRole("button", { name: "Apply Sunday NFL" })).toBeVisible();
  await list.getByRole("button", { name: "Delete Sunday NFL" }).click();
  await list.getByRole("button", { name: "Confirm delete Sunday NFL" }).click();
  await expect(list.getByText("No saved views yet.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
});
