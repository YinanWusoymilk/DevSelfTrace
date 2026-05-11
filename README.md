# DevSelfTrace

**DevSelfTrace** is a lightweight, browser-based annotation tool for retrospective self-annotation of programming behavior. Given a screen recording of a programming session, developers divide it into self-defined time intervals and annotate each interval across four dimensions — **intention**, **action**, **supporting tool**, and **emotion** — through guided dropdown menus. All annotations are exported as structured JSON for downstream analysis such as sequential pattern mining or qualitative coding.

**Project page**: <https://yinanwusoymilk.github.io/DevSelfTrace/> — abstract, tool overview, workflow walkthrough (with screenshots), evaluation highlights, and citation info. The source for the project page lives under [`docs/`](docs/) and is served via GitHub Pages.


## Installation:

1. Navigate to the project directory:
   ```bash
   cd DevSelfTrace
   ```
3. Install required dependencies:
   ```bash
   pip install bottle
   ```

## Running the Annotation Tool:

1. Open a terminal in IDE and go to the `app_study/` directory
   ```bash
   cd app_study
   ```
2. Run the server using the following command:
   ```bash
   python server.py -p data/inni_template.json
   ```
   or you can use python3 to run the command
   ```bash
   python3 server.py -p data/inni_template.json
   ```

3. Alternatively, you can use absolute paths:
   ```bash
   python server.py -p /absolute/path/to/data/inni_template.json
   ```
   or
   
   ```bash
   python3 server.py -p /absolute/path/to/data/inni_template.json
   ```
4. Once the command is executed accurately, copy and paste the following link into the address bar of your browser and press enter:
      ```bash
   http://localhost:8080/
   ```

   The UI of the Annotation tool will appear as:
   ![startUI](media/readmepic/startUINew.png)


## Using the Annotation Tool:

### About the Tool:

   - The goal of this tool is to help you annotate videos based on your coding intentions, actions, and supporting tools. 
   - Each annotation represents a step in your coding process, defined by the start and end times you set.
   
   - Each step will capture:
   
      1. Intention: The goal you aim to achieve at each step (e.g., "To Optimize Code").
      2. Action: The specific action you take to execute your intention (e.g., "Editing Existing Code").
      3. Supporting Tool: The tool or method you use to support your action (e.g., "AI tools," "Static Analysis").
   
   - For each step, you can:
   
      1. Select one intention that represents your goal.
      2. Choose multiple action-supporting tool pairs.
      3. Select one of seven emotion valences that best represents how you felt during that step.
   
   - As you watch the video, you can label these aspects, and your annotations, including timestamps, will be saved in a JSON file for further analysis.
   
   - **NOTE**: You’re required to annotate more than 20 logs
  
To annotate a video & save your annotations using this tool, follow these steps & attached screenshots:

### Loading a Video:
- Click on the `Choose File` button to Browse & Select your Video:
   ![chooseVideo](media/readmepic/chooseVideo.png)
- Once the video file is selected, click on the `Load Video` button to load the video into the annotation tool:
   ![loadVideo](media/readmepic/loadVideo.png)
- Upon successfull loading of the video the annotation tool UI will appear as:
   ![loadedVideo](media/readmepic/loadedVideo.png)

### Annotation Interface
- The annotation tool interface consists of several key components:
   - Video Player: Plays your Video within the tool.
   - Auto Play Button: Start or pause the video playback.
   - Time Slider: Navigate through the video timeline.
   - Set Start Time Button: To set the start time of the activity you want to annotate.
   - Set End Time Button: To set the end time of the activity you want to annotate.
   - Navigate Events < > Buttons: To move through the log entries made in the Logs Table.
     ![keycomp](media/readmepic/keycomp.png)

- The annotation tool - annotation actions:
  
   #### Add Log ~ Add a new annotation log at the current video timestamp:
   - For a particular timestamp that you want to **annotate**, please select the corresponding Start & End times using Set Start Time and Set End Time buttons as shown above.
   - **NOTE**: Answering all three questions is mandatory to Add/Save the annotation log.
   - Following that, select the annotations/answers for the given three questions as follows:
     - Q1 has a dropdown to select an intention as an annotation label in additon it also has option to provide your custom intention:
     ![q1New1](media/readmepic/q1New1.png)
     ![q1New2](media/readmepic/q1New2.png)
     - Q2 has 2 dropdowns to select Action & Tool pairs, in additon, it also has option to provide your custom actions & tools:
     ![q2blank](media/readmepic/q2blank.png)
     - NOTE: Here you need to click on the `Add Action-Tool Pair` button to add/save the Action-Tool Pair in Selected Action-Tool pairs view and subsequently click on the `Clear Selection` button if need to clear/delete the saved pairs:
     ![q2](media/readmepic/q2.png)
     - Q3 has a dropdown to select an emotion valence as an annotation label:
     ![q3](media/readmepic/q3.png)
     - Also, the annotations done for these 3 questions is displayed in the view called `Selected States`:
     ![addLogQ](media/readmepic/addLogQ.png)
     - Click on the `Add Log` button to complete the action of Adding the log to Logs table:
     ![addLogT](media/readmepic/addLogT.png)
   
   #### Edit Log ~ Modify an existing annotation log:
   - For a particular timestamp & log entry that you want to **edit** the annotations for, please use the `Navigate Events < >` buttons to hover/highlight upon the corresponding log entry in the Logs Table:
     ![edit1](media/readmepic/edit1.png)
   - **NOTE**: While editing the annotations, the editing for all three questions is NOT mandatory. You can just Edit the annotations for one or any two or all three questions anytime.
   - Following that, select the annotations/answers for the questions that you want to edit. The process will be similar to that of Add Log action for selecting the annotations.
   - The `Selected States` view will appear as:
     ![edit2](media/readmepic/edit2.png)
   - **NOTE**: Since, the annotations were edited for Q1 & Q2, the Q3 will remains `None` here and in the Logs Table the annotations of Q3 will remain unchanged/unedited. (Accordingly applicable to all the ways you perform Edit Log Action).
   - Click on the `Edit Label` to save & perform the Edit action for the corresponding log entry.
   - Upon successfull Edit, the `dialog box` appears stating completion of edit action & the corresponding log entry is **edited** in the `Logs Table`:
     ![edit3](media/readmepic/edit3.png)
     ![edit4](media/readmepic/edit4.png)
   
   #### Delete Log ~ Remove an annotation log entry from the Logs Table:
   - For a particular timestamp & log entry that you want to **delete** the log entry for, please use the `Navigate Events < >` buttons to hover/highlight upon the corresponding log entry in the Logs Table & click on `Delete Log` button to 
     perform the delete action:
     ![del1](media/readmepic/del1.png)
   - Upon successfull Delete, the `dialog box` appears stating completion of delete action & the corresponding log entry is **deleted** in the `Logs Table`:
     ![del2](media/readmepic/del2.png)
     ![del3](media/readmepic/del3.png)

## Locating your annotated JSON file:
- After annotating the video, your annotations are saved in the JSON format in the file named - `inni_template.json`

- The annotated JSON file will contain timestamps and annotations added during the session as shown below:

![savedLog](media/readmepic/savedLog.png)

- By default, the annotated JSON file - `inni_template.json` will be saved in the project directory as :

```
DevSelfTrace/
├── app_study/
│   ├── data/
│   │   └── inni_template.json

```


## License:

This project is licensed under the MIT License - see the LICENSE file for details.




---
