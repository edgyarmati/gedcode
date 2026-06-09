let diffExamples = """
More Examples illustrating how to apply the guidelines to this input:
  
  -- EXAMPLE 1: Adding new lines
  <th>
  Add input validation to ensure arguments are numbers. Will insert two new lines after the function definition.
  </th>
  
  [INCORRECT]
  ###JSON_START###
  {
  "file_path": "example.py",
  "changes": [
   {
  "description": "Add input validation to calculate_sum function",
  "start_line": 1,
  "chunk": [
  "1:<s0>def calculate_sum(a, b):",
  "2:<s4>if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):",
  "3:<s8>raise ValueError(\\"Both arguments must be numbers\\")",
  "4:<s4>result = a + b",
  "5:<s4>return result"
  ]
   }
  ]
  }
  ###JSON_END###
  
  Explanation: This example is incorrect because it assigns line numbers to new lines instead of using the '+' prefix.
  
  [CORRECT]
  ###JSON_START###
  {
  "file_path": "example.py",
  "changes": [
   {
  "description": "Add input validation to calculate_sum function",
  "start_line": 1,
  "chunk": [
  "1:<s0>def calculate_sum(a, b):",
  "+<s4>if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):",
  "+<s8>raise ValueError(\\"Both arguments must be numbers\\")",
  "2:<s4>result = a + b",
  "3:<s4>return result"
  ]
   }
  ]
  }
  ###JSON_END###
  
  Explanation: This example correctly adds new lines with the '+' prefix and maintains proper line numbers for existing lines.
  
  -- EXAMPLE 2: Modifying existing lines
  <th>
  Modify the print statement to include input values. Will replace line 9 with a more detailed print statement.
  </th>
  
  [INCORRECT]
  ###JSON_START###
  {
  "file_path": "example.py",
  "changes": [
   {
  "description": "Modify print statement to include input values",
  "start_line": 8,
  "chunk": [
  "8:<s4>total = calculate_sum(x, y)",
  "9:<s4>print(f\\"The sum of {x} and {y} is: {total}\\")",
  "10:<s0>"
  ]
   }
  ]
  }
  ###JSON_END###
  
  Explanation: This example is incorrect because it doesn't use the '-' prefix for the line being deleted, and a '+' for the line that replaces it.
  
  [CORRECT]
  ###JSON_START###
  {
  "file_path": "example.py",
  "changes": [
   {
  "description": "Modify print statement to include input values",
  "start_line": 8,
  "chunk": [
  "8:<s4>total = calculate_sum(x, y)",
  "-9:<s4>print(f\\"The sum is: {total}\\")",
  "+<s4>print(f\\"The sum of {x} and {y} is: {total}\\")",
  "10:<s0>"
  ]
   }
  ]
  }
  ###JSON_END###
  
  Explanation: This example correctly uses the '-' prefix for the line being modified and the '+' prefix for the new line that replaces the old one.
  
  -- EXAMPLE 3: Correct indentation
  <th>
  Add error handling to the main function. Will wrap existing code in a try-except block and add two new lines for exception handling.
  </th>
  
  [INCORRECT]
  ###JSON_START###
  {
  "file_path": "example.py",
  "changes": [
   {
  "description": "Add error handling to main function",
  "start_line": 5,
  "chunk": [
  "5:  def main():",
  "+6:    try:",
  "7:      x = 5",
  "8:      y = 10",
  "9:      total = calculate_sum(x, y)",
  "10:     print(f\\"The sum is: {total}\\")",
  "+11:   except ValueError as e:",
  "+12:     print(f\\"Error: {e}\\")",
  "13:"
  ]
   }
  ]
  }
  ###JSON_END###
  
  Explanation: This example is incorrect because it doesn't use the indentation tags (<s0>, <s4>, <s8>) to represent the indentation levels.
  
  [CORRECT]
  ###JSON_START###
  {
  "file_path": "example.py",
  "changes": [
   {
  "description": "Add error handling to main function",
  "start_line": 5,
  "chunk": [
  "5:<s0>def main():",
  "+<s4>try:",
  "6:<s4>x = 5",
  "7:<s4>y = 10",
  "8:<s4>total = calculate_sum(x, y)",
  "9:<s4>print(f\\"The sum is: {total}\\")",
  "+<s4>except ValueError as e:",
  "+<s8>print(f\\"Error: {e}\\")",
  "10:<s0>"
  ]
   }
  ]
  }
  ###JSON_END###
  
  Explanation: This example correctly uses the indentation tags (<s0>, <s4>, <s8>) to represent the indentation levels and uses the '+' prefix for new lines.
  
  -- EXAMPLE 4: Deleting multiple lines
  <th>
  Remove unnecessary variable assignments. Will delete lines 6 and 7, replacing them with user input.
  </th>
  
  [INCORRECT]
  ###JSON_START###
  {
  "file_path": "example.py",
  "changes": [
   {
  "description": "Remove unnecessary variable assignments",
  "start_line": 5,
  "chunk": [
  "5:<s0>def main():",
  "8:<s4>total = calculate_sum(5, 10)",
  "9:<s4>print(f\\"The sum is: {total}\\")",
  "10:<s0>"
  ]
   }
  ]
  }
  ###JSON_END###
  
  Explanation: This example is incorrect because it doesn't use the '-' prefix for lines being removed.
  
  [CORRECT]
  ###JSON_START###
  {
  "file_path": "example.py",
  "changes": [
   {
  "description": "Replace hardcoded values with user input",
  "start_line": 5,
  "chunk": [
  "5:<s0>def main():",
  "-6:<s4>x = 5",
  "-7:<s4>y = 10",
  "+<s4>x = float(input(\\"Enter first number: \\"))",
  "+<s4>y = float(input(\\"Enter second number: \\"))",
  "8:<s4>total = calculate_sum(x, y)",
  "9:<s4>print(f\\"The sum is: {total}\\")"
  ]
   }
  ]
  }
  ###JSON_END###
  
  Explanation: This example correctly uses the '-' prefix for lines being removed and the '+' prefix for new lines being added.
  
  -- EXAMPLE 5: Complex changes with additions, modifications, and deletions
  <th>
  Refactor main function with error handling and user input. Will wrap existing code in try-except block, replace hardcoded values with user input, and modify the print statement.
  </th>
  
  [INCORRECT]
  ###JSON_START###
  {
  "file_path": "example.py",
  "changes": [
   {
  "description": "Refactor main function with error handling and user input",
  "start_line": 5,
  "chunk": [
  "5:<s0>def main():",
  "+<s4>try:",
  "-6:<s4>x = 5",
  "-7:<s4>y = 10",
  "+<s8>x = float(input(\\"Enter first number: \\"))",
  "+<s8>y = float(input(\\"Enter second number: \\"))",
  "8:<s4>total = calculate_sum(x, y)",
  "9:<s4>print(f\\"The sum of {x} and {y} is: {total}\\")",
  "+<s4>except ValueError as e:",
  "+<s8>print(f\\"Error: {e}\\")",
  "10:<s0>",
  "11:<s0>if __name__ == \\"__main__\\":"
  ]
   }
  ]
  }
  ###JSON_END###
  
  Explanation: This example is incorrect because it doesn't use the '-' prefix for the modified line 9.
  
  [CORRECT]
  ###JSON_START###
  {
  "file_path": "example.py",
  "changes": [
   {
  "description": "Refactor main function with error handling and user input",
  "start_line": 5,
  "chunk": [
  "5:<s0>def main():",
  "+<s4>try:",
  "-6:<s4>x = 5",
  "-7:<s4>y = 10",
  "+<s8>x = float(input(\\"Enter first number: \\"))",
  "+<s8>y = float(input(\\"Enter second number: \\"))",
  "8:<s4>total = calculate_sum(x, y)",
  "-9:<s4>print(f\\"The sum is: {total}\\")",
  "+<s8>print(f\\"The sum of {x} and {y} is: {total}\\")",
  "+<s4>except ValueError as e:",
  "+<s8>print(f\\"Error: {e}\\")",
  "10:<s0>",
  "11:<s0>if __name__ == \\"__main__\\":"
  ]
   }
  ]
  }
  ###JSON_END###
  
  Explanation: This example correctly handles complex changes by using '+' for new lines, '-' for removed or modified lines, and maintains proper indentation tags and line numbers throughout.
  
  -- EXAMPLE 6: Context lines
  <th>
  Modify calculate_sum function to use multiplication instead of addition. Will replace the addition operation with multiplication.
  </th>
  
  [INCORRECT]
  ###JSON_START###
  {
  "file_path": "example.py",
  "changes": [
   {
  "description": "Modify calculate_sum function to use multiplication",
  "start_line": 1,
  "chunk": [
  "1:<s0>def calculate_sum(a, b):",
  "-2:<s4>result = a + b",
  "+<s4>result = a * b",
  "3:<s4>return result",
  "4:<s0>",
  "5:<s0>def main():",
  "6:<s4>x = 5",
  "7:<s4>y = 10"
  ]
   }
  ]
  }
  ###JSON_END###
  
  Explanation: This example is incorrect because it includes too many context lines after the change.
  
  [CORRECT]
  ###JSON_START###
  {
  "file_path": "example.py",
  "changes": [
   {
  "description": "Modify calculate_sum function to use multiplication",
  "start_line": 1,
  "chunk": [
  "1:<s0>def calculate_sum(a, b):",
  "-2:<s4>result = a + b",
  "+<s4>result = a * b",
  "3:<s4>return result"
  ]
   }
  ]
  }
  ###JSON_END###
  
  Explanation: This example correctly includes only 1-3 lines of context before and after the change.
  
  -- EXAMPLE 7: Adding comment lines
  <th>
  Add comments to explain the calculate_sum function. Will insert two new comment lines after the function definition.
  </th>
  [INCORRECT]
  ###JSON_START###
  {
  "file_path": "example.py",
  "changes": [
   {
  "description": "Add comments to explain the calculate_sum function",
  "start_line": 1,
  "chunk": [
  "1:<s0>def calculate_sum(a, b):",
  "2:<s4># This function calculates the sum of two numbers",
  "3:<s4># It takes two parameters: a and b",
  "4:<s4>result = a + b",
  "5:<s4>return result"
  ]
   }
  ]
  }
  ###JSON_END###
  
  Explanation: This example is incorrect because it assigns line numbers to the new comment lines instead of using the '+' prefix.
  
  [CORRECT]
  ###JSON_START###
  {
  "file_path": "example.py",
  "changes": [
   {
  "description": "Add comments to explain the calculate_sum function",
  "start_line": 1,
  "chunk": [
  "1:<s0>def calculate_sum(a, b):",
  "+<s4># This function calculates the sum of two numbers",
  "+<s4># It takes two parameters: a and b",
  "2:<s4>result = a + b",
  "3:<s4>return result"
  ]
   }
  ]
  }
  ###JSON_END###
  
  Explanation: This example correctly adds new comment lines using the '+' prefix and maintains proper line numbers for existing lines.
"""

let diffExamples2 = """
More Examples illustrating how to apply the guidelines to this input:

-- EXAMPLE 1: C# with curly braces and indentation

File: Person.cs
Path: Models/Person.cs
Line count: 8

Content:
1:<s0>public class Person
2:<s0>{
	3:<s4>public string Name { get; set; }
	4:<s4>public DateTime DateOfBirth { get; set; }
	5:<s0>
	6:<s4>public Person(string name, DateTime dateOfBirth)
	7:<s4>{
		8:<s8>Name = name;
		9:<s8>DateOfBirth = dateOfBirth;
		10:<s4>}
	11:<s0>}

<th>
Add a new method to the Person class to calculate age. Will insert a new method after the existing constructor.
</th>

[INCORRECT]
###JSON_START###
{
	"file_path": "Models/Person.cs",
	"changes": [
		{
			"description": "Add CalculateAge method to Person class",
			"start_line": 10,
			"chunk": [
				"10:<s4>}",
				"11:",
				"12:<s4>public int CalculateAge()",
				"13:<s4>{",
				"14:<s8>var today = DateTime.Today;",
				"15:<s8>var age = today.Year - DateOfBirth.Year;",
				"16:<s8>if (DateOfBirth.Date > today.AddYears(-age)) age--;",
				"17:<s8>return age;",
				"18:<s4>}",
				"19:<s0>}"
			]
		}
	]
}
###JSON_END###

Explanation: This example is incorrect because it assigns line numbers to new lines instead of using the '+' prefix and doesn't properly handle the closing curly brace of the class.

[CORRECT]
###JSON_START###
{
	"file_path": "Models/Person.cs",
	"changes": [
		{
			"description": "Add CalculateAge method to Person class",
			"start_line": 10,
			"chunk": [
				"10:<s4>}",
				"+<s0>",
				"+<s4>public int CalculateAge()",
				"+<s4>{",
				"+<s8>var today = DateTime.Today;",
				"+<s8>var age = today.Year - DateOfBirth.Year;",
				"+<s8>if (DateOfBirth.Date > today.AddYears(-age)) age--;",
				"+<s8>return age;",
				"+<s4>}",
				"11:<s0>}"
			]
		}
	]
}
###JSON_END###

Explanation: This example correctly adds new lines with the '+' prefix, maintains proper indentation using <s0>, <s4>, and <s8> tags, and keeps the closing curly brace of the class intact.

-- EXAMPLE 2: Python with significant whitespace

File: data_processor.py
Path: utils/data_processor.py
Line count: 4

Content:
1:<s0>def process_data(data):
2:<s4>result = perform_complex_operation(data)
3:<s4>return result
4:<s0>

<th>
Modify the existing function to include error handling and logging. Will wrap the function body in a try-except block.
</th>

[INCORRECT]
###JSON_START###
{
	"file_path": "utils/data_processor.py",
	"changes": [
		{
			"description": "Add error handling and logging to process_data function",
			"start_line": 1,
			"chunk": [
				"1:<s0>def process_data(data):",
				"2:<s4>try:",
				"3:<s8>result = perform_complex_operation(data)",
				"4:<s8>return result",
				"5:<s4>except Exception as e:",
				"6:<s8>logging.error(f\\"Error processing data: {e}\\")",
				"7:<s8>raise"
			]
		}
	]
}
###JSON_END###

Explanation: This example is incorrect because it doesn't use the '+' prefix for new lines and '-' prefix for modified lines.
																					
																					[CORRECT]
																					###JSON_START###
{
	"file_path": "utils/data_processor.py",
	"changes": [
		{
			"description": "Add error handling and logging to process_data function",
			"start_line": 1,
			"chunk": [
				"1:<s0>def process_data(data):",
				"-2:<s4>result = perform_complex_operation(data)",
				"-3:<s4>return result",
				"+<s4>try:",
				"+<s8>result = perform_complex_operation(data)",
				"+<s8>return result",
				"+<s4>except Exception as e:",
				"+<s8>logging.error(f\\"Error processing data: {e}\\")",
				"+<s8>raise",
				"4:<s0>"
			]
		}
	]
}
###JSON_END###

Explanation: This example correctly uses '+' for new lines, '-' for removed lines, and maintains proper indentation using the <s0>, <s4>, and <s8> tags.
													
													-- EXAMPLE 3: JavaScript with complex nested structures
													
													File: api_client.js
													Path: src/api_client.js
													Line count: 14
													
													Content:
														1:<s0>function fetchUserData(userId) {
	2:<s4>return new Promise((resolve, reject) => {
		3:<s8>fetchUser(userId, (err, user) => {
			4:<s12>if (err) return reject(err);
			5:<s12>fetchPosts(user.id, (err, posts) => {
				6:<s16>if (err) return reject(err);
				7:<s16>fetchComments(posts.map(p => p.id), (err, comments) => {
					8:<s20>if (err) return reject(err);
					9:<s20>resolve({ user, posts, comments });
					10:<s16>});
				11:<s12>});
			12:<s8>});
		13:<s4>});
	14:<s0>}

<th>
Refactor the existing nested callbacks into async/await syntax. Will replace the entire function body.
</th>

[INCORRECT]
###JSON_START###
{
	"file_path": "src/api_client.js",
	"changes": [
		{
			"description": "Refactor fetchUserData function to use async/await",
			"start_line": 1,
			"chunk": [
				"1:function fetchUserData(userId) {",
				"2:  return new Promise(async (resolve, reject) => {",
				"3:    try {",
				"4:      const user = await fetchUser(userId);",
				"5:      const posts = await fetchPosts(user.id);",
				"6:      const comments = await fetchComments(posts.map(p => p.id));",
				"7:      resolve({ user, posts, comments });",
				"8:    } catch (error) {",
				"9:      reject(error);",
				"10:    }",
				"11:  });",
				"12:}"
			]
		}
	]
}
###JSON_END###

Explanation: This example is incorrect because it doesn't use the '-' prefix for removed lines, '+' prefix for new lines, and doesn't encode indentation properly.
																					
																					[CORRECT]
																					###JSON_START###
{
	"file_path": "src/api_client.js",
	"changes": [
		{
			"description": "Refactor fetchUserData function to use async/await",
			"start_line": 1,
			"chunk": [
				"1:<s0>function fetchUserData(userId) {",
				"-2:<s4>return new Promise((resolve, reject) => {",
				"-3:<s8>fetchUser(userId, (err, user) => {",
				"-4:<s12>if (err) return reject(err);",
				"-5:<s12>fetchPosts(user.id, (err, posts) => {",
				"-6:<s16>if (err) return reject(err);",
				"-7:<s16>fetchComments(posts.map(p => p.id), (err, comments) => {",
				"-8:<s20>if (err) return reject(err);",
				"-9:<s20>resolve({ user, posts, comments });",
				"-10:<s16>});",
				"-11:<s12>});",
				"-12:<s8>});",
				"-13:<s4>});",
				"+<s4>return new Promise(async (resolve, reject) => {",
				"+<s8>try {",
				"+<s12>const user = await fetchUser(userId);",
				"+<s12>const posts = await fetchPosts(user.id);",
				"+<s12>const comments = await fetchComments(posts.map(p => p.id));",
				"+<s12>resolve({ user, posts, comments });",
				"+<s8>} catch (error) {",
				"+<s12>reject(error);",
				"+<s8>}",
				"+<s4>});",
				"14:<s0>}"
			]
		}
	]
}
###JSON_END###

Explanation: This example correctly uses '-' for removed lines, '+' for new lines, preserves the original function signature and closing brace, and encodes indentation properly using <s0>, <s4>, <s8>, <s12>, <s16>, and <s20> tags.
													
"""

let diffExamplesCSharp = """
-- EXAMPLE: Complex C# method modification

File: GameManager.cs
Path: Assets/Scripts/GameManager.cs
Line count: 20

Content:
1:<s0>public class GameManager : MonoBehaviour
2:<s0>{
3:<s4>private int score;
4:<s4>private bool isGameOver;
5:<s0>
6:<s4>public void StartGame()
7:<s4>{
8:<s8>score = 0;
9:<s8>isGameOver = false;
10:<s8>Debug.Log("Game started");
11:<s4>}
12:<s0>
13:<s4>public void EndGame()
14:<s4>{
15:<s8>isGameOver = true;
16:<s8>Debug.Log("Game over");
17:<s8>SaveScore();
18:<s4>}
19:<s0>
20:<s4>private void SaveScore()
21:<s4>{
22:<s8>// TODO: Implement score saving
23:<s4>}
24:<s0>}

<th>
Modify the GameManager class to add player health, update the StartGame method to initialize health, add a TakeDamage method, and modify the EndGame method to check for player death. We'll also implement the SaveScore method.
</th>

[INCORRECT]
###JSON_START###
{
"file_path": "Assets/Scripts/GameManager.cs",
"changes": [
 {
"description": "Update GameManager class with health system and score saving",
"start_line": 3,
"chunk": [
"3:<s4>private int score;",
"4:<s4>private bool isGameOver;",
"+<s4>private int playerHealth;",
"5:<s0>",
"6:<s4>public void StartGame()",
"7:<s4>{",
"8:<s8>score = 0;",
"9:<s8>isGameOver = false;",
"+<s8>playerHealth = 100;",
"10:<s8>Debug.Log("Game started");",
"11:<s4>}",
"12:<s0>",
"+<s4>public void TakeDamage(int damage)",
"+<s4>{",
"+<s8>playerHealth -= damage;",
"+<s8>if (playerHealth <= 0)",
"+<s8>{",
"+<s12>EndGame();",
"+<s8>}",
"+<s4>}",
"13:<s4>public void EndGame()",
"14:<s4>{",
"15:<s8>isGameOver = true;",
"+<s8>Debug.Log($"Game over. Final score: {score}");",
"-16:<s8>Debug.Log("Game over");",
"17:<s8>SaveScore();",
"18:<s4>}",
"19:<s0>",
"20:<s4>private void SaveScore()",
"21:<s4>{",
"-22:<s8>// TODO: Implement score saving",
"+<s8>PlayerPrefs.SetInt("LastScore", score);",
"+<s8>PlayerPrefs.Save();",
"+<s8>Debug.Log($"Score {score} saved successfully");",
"23:<s4>}",
"24:<s0>}"
]
 }
]
}
###JSON_END###

Explanation: This example is incorrect because it doesn't properly handle the removal and addition of lines, especially around the EndGame method. It also doesn't use the '+' prefix consistently for all new lines.

[CORRECT]
###JSON_START###
{
"file_path": "Assets/Scripts/GameManager.cs",
"changes": [
 {
"description": "Update GameManager class with health system and score saving",
"start_line": 3,
"chunk": [
"3:<s4>private int score;",
"4:<s4>private bool isGameOver;",
"+<s4>private int playerHealth;",
"5:<s0>",
"6:<s4>public void StartGame()",
"7:<s4>{",
"8:<s8>score = 0;",
"9:<s8>isGameOver = false;",
"+<s8>playerHealth = 100;",
"10:<s8>Debug.Log(\\"Game started\\");",
"11:<s4>}",
"12:<s0>",
"+<s4>public void TakeDamage(int damage)",
"+<s4>{",
"+<s8>playerHealth -= damage;",
"+<s8>if (playerHealth <= 0)",
"+<s8>{",
"+<s12>EndGame();",
"+<s8>}",
"+<s4>}",
"+<s0>",
"13:<s4>public void EndGame()",
"14:<s4>{",
"15:<s8>isGameOver = true;",
"-16:<s8>Debug.Log(\\"Game over\\");",
"+<s8>Debug.Log($\\"Game over. Final score: {score}\\");",
"17:<s8>SaveScore();",
"18:<s4>}",
"19:<s0>",
"20:<s4>private void SaveScore()",
"21:<s4>{",
"-22:<s8>// TODO: Implement score saving",
"+<s8>PlayerPrefs.SetInt(\\"LastScore\\", score);",
"+<s8>PlayerPrefs.Save();",
"+<s8>Debug.Log($\\"Score {score} saved successfully\\");",
"23:<s4>}",
"24:<s0>}"
]
 }
]
}
###JSON_END###

Explanation: This example correctly handles the interleaved additions and removals, maintaining proper structure and indentation. It uses '+' for all new lines and '-' for removed lines, preserving curly braces and method structures. The changes are more concise while still showing the full context of modifications.

"""
